'''One objective package, optionally followed by one bounded mediation step.'''

import itertools
import json
import math
import re
import time
import traceback
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from threading import Condition, RLock

from arena_kit import complete_offer, must_haves_ok, total_cost
from arena_kit.cost import closing_terms, supplier_value
from proto import practice as data
from proto.engine import BREAKDOWN, ENDED, SIGN
from proto.practice import PracticeNegotiator


# These are time/uncertainty allowances, not case-specific bargaining targets.
SUPPLIER_WAIT = 120.0
CLOSE_RESERVE = 80.0
DISPATCH_RESERVE = 5.0
READ_INTERVAL = 2.0
PLAN_SECONDS = 1.0
CATALOGUE_LIMIT = 256
CONDITION = re.compile(r'\b(provided|conditional|condition|require|must|only if|subject to)\b', re.I)
MIDPOINT = re.compile(r'mid[ -]?point|split\s+(?:the\s+)?difference', re.I)


def thaw(value):
    '''Copy protocol values without copying a Thread or its locks.'''
    if isinstance(value, Mapping):
        return {k: thaw(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [thaw(v) for v in value]
    return value


def canonical(value):
    return json.dumps(thaw(value), sort_keys=True, separators=(',', ':'), allow_nan=False)


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class Negotiator(PracticeNegotiator):
    def __init__(self, *args, **kwargs):
        self._opened = time.time()
        self._lock = RLock()
        self._changed = Condition(self._lock)
        self._states = {}
        self._spent = set()
        self._reserved = set()
        self._attempted = set()
        self._portfolio = ()
        self._closing = None
        self._close_outcome = None
        self._confirmed = None
        self._stop = False
        self._rival_used = False
        self._walk_used = False
        super().__init__(*args, **kwargs)
        if self.deadline is None:
            self.deadline = self._opened + 480.0
        self._initial = {t.sid: thaw(t.est) for t in self.threads.values()}

    def _estimate(self):
        '''Seed only this supplier's inputs; inherited cross-supplier imputation is unsafe here.'''
        margin = self.b.get('sustainable_margin_pct')
        margin = margin / 100 if number(margin) and 0 <= margin < 100 else 0.0
        for t in self.threads.values():
            std = closing_terms(self.case, {}, t.std)
            try:
                rate = data.cash_rate(t.sid)
            except Exception:
                self.note('objective_rate_fallback', supplier=t.sid, error=traceback.format_exc())
                rate = self.b.get('interest_rate') or 0.0
            if not number(rate) or rate < 0:
                rate = self.b.get('interest_rate') or 0.0
            own = next((s.get('terms', {}).get('unit_price') for s in t.sheets
                        if number(s.get('terms', {}).get('unit_price'))), None)
            t.est = {'standard': std, 'interest_rate': rate}
            if own and own > 0:
                t.est.update(full_cost=own * (1 - margin), floor=own * (1 - margin),
                             basis='uncertain inference from this supplier opening only')
        # The diagnostic does not determine a posted price.
        self.target_c, self.target_sup, self.target_terms = self.c_open, None, None
        self.note('objective_initial_estimate', target_c=self.target_c,
                  inputs={t.sid: thaw(t.est) for t in self.threads.values()})

    def styled(self, t, msg):
        # The strategy is deterministic even when the host variant enables its writer.
        return msg

    def prepare_message(self, t, msg):
        # Our compiler owns provenance and reservations; no planner keys enter the arena.
        if 'action' in msg:
            return {'action': thaw(msg['action'])}
        return {k: thaw(msg[k]) for k in ('subject', 'body', 'refs', 'term_sheets')}

    def _key(self, message):
        return message.get('message_id') or canonical({k: message.get(k) for k in
                                                       ('from', 'status', 'body', 'term_sheets')})

    def _economics(self, t):
        initial = self._initial.get(t.sid, {})
        return {'standard': thaw(initial.get('standard') or closing_terms(self.case, {}, t.std)),
                'interest_rate': initial.get('interest_rate') or 0.0}

    def _legal(self, t, raw):
        if not isinstance(raw, Mapping) or not raw:
            return None
        try:
            std = t.std if t is not None else None
            closed = closing_terms(self.case, thaw(raw), std)
            out = thaw(complete_offer(self.case, closed))
            if set(out) != set(self.case['negotiable']):
                return None
            p = out.get('unit_price', closed.get('unit_price'))
            if not number(p) or p <= 0:
                return None
            for field, fixed in self.case.get('fixed_terms', {}).items():
                if closed.get(field) != thaw(fixed):
                    return None
            for field in self.case['negotiable']:
                if out[field] != thaw(closed.get(field)):
                    return None  # Snapping is not permission to change a closing contract.
                options = self.case.get('term_options', {}).get(field)
                if options and not any(out[field] == thaw(o) for o in options):
                    return None
            if not must_haves_ok(self.case, out, std):
                return None
            canonical(out)
            return out
        except (TypeError, ValueError, KeyError, ZeroDivisionError, OverflowError):
            return None

    def _nonprice(self, t, terms):
        closed = closing_terms(self.case, terms, t.std)
        return canonical({k: v for k, v in closed.items() if k != 'unit_price'})

    def _risk(self, t, terms):
        c = self.C(t, terms)
        values = [c]
        s = self._states.get(t.sid, {})
        band = s.get('cost_band')
        if self.relationship and band:
            base = self._economics(t)
            for full in band:
                for factor in (0.8, 1.0, 1.2):
                    estimate = {**base, 'full_cost': full,
                                'interest_rate': base['interest_rate'] * factor}
                    values.append(total_cost(self.case, terms, t.std, estimate))
        if not all(number(v) for v in values):
            raise ValueError('nonfinite complete-contract cost')
        return c, max(values), tuple(values)

    def _candidate(self, t, terms, cap=True):
        terms = self._legal(t, terms)
        if terms is None:
            return None
        if cap:
            matching = []
            for sheet in t.sheets:
                existing = self._legal(t, sheet.get('terms'))
                if existing and self._nonprice(t, existing) == self._nonprice(t, terms):
                    matching.append(existing['unit_price'])
            if matching and terms['unit_price'] > min(matching):
                self.note('objective_guard', supplier=t.sid, reason='identical_term_overbid', terms=terms)
                return None
        try:
            c, worst, scenarios = self._risk(t, terms)
        except Exception:
            self.note('objective_cost_error', supplier=t.sid, error=traceback.format_exc())
            return None
        if c > self.c_alt:
            return None
        return {'terms': terms, 'C': c, 'conservative': worst, 'scenarios': scenarios}

    @staticmethod
    def _rank(row):
        terms = row['terms']
        # Supplier-friendly ties require indistinguishable costs in every checked scenario.
        return (row['conservative'], row['C'], row['scenarios'],
                -(terms.get('lead_time_days') or 0), -(terms.get('contract_months') or 0))

    def _standing(self, t):
        if t.closed or (t.status in ENDED and t.status != 'agreed'):
            return ()
        rows = []
        for index, sheet in enumerate(t.sheets):
            offer_id = sheet.get('term_sheet_id')
            if not offer_id or (t.sid, offer_id) in self._attempted:
                continue
            row = self._candidate(t, sheet.get('terms'), cap=False)
            if row:
                rows.append({**row, 'supplier': t.sid, 'id': offer_id, 'primary': index == 0,
                             'revision': t.event_revision})
        return tuple(sorted(rows, key=self._rank))

    def _publish(self, t):
        rows = self._standing(t)
        with self._changed:
            s = self._states[t.sid]
            s['safe'] = rows
            s['status'], s['revision'] = t.status, t.event_revision
            s['uncertain'] = bool(t.state_uncertain or t.pending_request)
            # Published records are replaced, never mutated or populated with Thread objects.
            self._portfolio = tuple(thaw(row) for state in self._states.values() for row in state['safe'])
            self._changed.notify_all()

    def resync(self, t, refresh_clock=True):
        '''An authoritative read also forms the boundary of the legacy acceptance retry.'''
        started = time.time()
        s = self._states.get(t.sid)
        with self._changed:
            was_flying = s['in_flight'] if s else False
            if s:
                s['in_flight'] = True
        try:
            reply = self.c.thread(self.sid, t.sid)
            messages = reply.get('messages')
            if not isinstance(messages, (list, tuple)) or not any(m.get('from') != 'buyer' for m in messages):
                raise ValueError('authoritative thread has no usable ordered history')
            messages = thaw(messages)
            incoming = [self._key(m) for m in messages if m.get('from') != 'buyer']
            current = [self._key(m) for m in t.events if m.get('from') != 'buyer']
            if incoming[-1] != current[-1] and incoming[-1] in current:
                raise ValueError('stale authoritative history')
            old = self._key(t.last)
            t.events = messages
            t.closed = bool(reply.get('closed'))
            if self._key(t.last) != old:
                t.event_revision += 1
            pending = s.get('pending_key') if s else None
            resolved = not pending or self._key(t.last) != pending
            t.state_uncertain = not resolved
            if resolved:
                t.pending_request = None
                if s:
                    s['pending_key'] = None
            if s:
                s['authoritative_at'] = started
                s['outbound'] = max(s['outbound'], t.sent())
            self._docs(t.events, t)
            if s and s.get('accept_started'):
                primary = next((r for r in self._standing(t) if r['primary']), None)
                if (not primary or not resolved or self._wave_left() <= DISPATCH_RESERVE
                        or self._turn_left(t) <= DISPATCH_RESERVE
                        or s['outbound'] + 1 > self._limit
                        or s.get('accept_retry')):
                    raise RuntimeError('checked acceptance retry refused')
                with self._changed:
                    if (t.sid, primary['id']) in self._attempted:
                        raise RuntimeError('authoritative offer already attempted')
                    self._attempted.add((t.sid, primary['id']))
                    s['outbound'] += 1
                    s['accept_retry'] = True
                self.note('objective_accept_retry', supplier=t.sid, offer=primary['id'], C=primary['C'])
            self.note('objective_resync', supplier=t.sid, status=t.status, revision=t.event_revision,
                      closed=t.closed, resolved=resolved, duration=time.time() - started)
            return resolved
        except Exception:
            t.state_uncertain = True
            self.note('objective_read_error', supplier=t.sid, error=traceback.format_exc(),
                      duration=time.time() - started)
            if s and s.get('accept_started'):
                raise
            return False
        finally:
            with self._changed:
                if s:
                    s['in_flight'] = was_flying
                self._changed.notify_all()

    def _authorized(self, ref):
        if not isinstance(ref, str) or not ref:
            return False
        try:
            source = self.claim_source(ref)
            if not source:
                return False
            if isinstance(source, Mapping):
                if source.get('authorized') is False or source.get('valid') is False:
                    return False
            return True
        except Exception:
            self.note('objective_provenance_error', ref=ref, error=traceback.format_exc())
            return False

    def _own_direct(self, t):
        found = None
        for message in t.events:
            if message.get('from') in ('buyer', 'arena'):
                continue
            text = (message.get('body') or '') + ' ' + ' '.join(
                a.get('text') or '' for a in message.get('attachments') or [])
            match = BREAKDOWN.search(text)
            if match:
                value = sum(float(x) for x in match.groups())
                if number(value) and value > 0:
                    found = (value, self._key(message))
        return found

    @staticmethod
    def _median(entries):
        ordered = sorted(entries, key=lambda x: x[0])
        halfway = sum(weight for _, weight in ordered) / 2
        accumulated = 0.0
        for value, weight in ordered:
            accumulated += weight
            if accumulated >= halfway:
                return value
        return ordered[-1][0]

    def _fair(self, t, until):
        margin = self.b.get('sustainable_margin_pct')
        if margin is None:
            margin = 0.0
        if not number(margin) or not 0 <= margin < 100:
            self.note('objective_guard', supplier=t.sid, reason='invalid_revenue_margin')
            return None
        divisor = 1 - margin / 100
        sources, costs, atoms = [], [], []
        own = self._own_direct(t)
        lower = 0.0
        if own:
            direct, event = own
            lower = direct / divisor
            sources.append({'kind': 'own_direct_lower_bound', 'quality': 'supplier_documented_unverified',
                            'source': event, 'lo': lower, 'hi': direct * 1.15 / divisor,
                            'center': direct * 1.075 / divisor, 'weight': 1.0})
            costs.append((direct, direct * 1.15, direct * 1.075))
        rows = []
        if time.perf_counter() < until and self.case.get('parts'):
            try:
                rows = data.q('SELECT id, unit_cost, supplier_id, part_id FROM should_cost '
                              'WHERE part_id = ? AND (supplier_id = ? OR supplier_id IS NULL)',
                              (self.case['parts'][0], t.sid)) or []
            except Exception:
                self.note('objective_data_error', supplier=t.sid, error=traceback.format_exc())
        legacy_refs = set()
        if time.perf_counter() < until:
            try:
                for refs, _sentence in self.facts_for(t):
                    refs = refs if isinstance(refs, (list, tuple)) else [refs]
                    legacy_refs.update(r for r in refs if isinstance(r, str) and r)
            except Exception:
                self.note('objective_fact_error', supplier=t.sid, error=traceback.format_exc())
        seen = set()
        for row in rows:
            if time.perf_counter() >= until:
                break
            ref, cost = row.get('id'), row.get('unit_cost')
            if (ref in seen or not number(cost) or cost <= 0
                    or row.get('supplier_id') not in (None, t.sid)
                    or row.get('part_id') not in self.case['parts']):
                continue
            seen.add(ref)
            sources.append({'kind': 'applicable_should_cost', 'quality': 'estimated', 'source': ref,
                            'lo': cost * 0.85 / divisor, 'hi': cost * 1.15 / divisor,
                            'center': cost / divisor, 'weight': 1.0})
            costs.append((cost * 0.85, cost * 1.15, cost))
            if ref in legacy_refs or ref in (self.case.get('refs') or []):
                if self._authorized(ref):
                    atoms.append({'ids': (ref,), 'issue': 'cost', 'specific': row.get('supplier_id') == t.sid,
                                  'text': f'Our applicable should-cost estimate is EUR {cost:.2f} ({ref}); '
                                          'it is an estimate, not a verified supplier cost.'})
        alt = self.alt
        quote = self._outside_terms
        ref = alt.get('ref') or ''
        opening = next((self._legal(t, sh.get('terms')) for sh in t.sheets
                        if self._legal(t, sh.get('terms'))), None)
        if quote and opening and self._authorized(ref) and time.perf_counter() < until:
            # Cash terms can be normalized; unlike coverage/risk contracts are not comparable evidence.
            a = closing_terms(self.case, quote)
            o = closing_terms(self.case, opening, t.std)
            fields = ('volume_per_year', 'contract_months', 'effective_date', 'lead_time_days',
                      'ppm_commitment', 'chargeback_eur_per_complaint', 'index_clause')
            if all(a.get(k) == o.get(k) for k in fields):
                worth = supplier_value(self.case, quote, self._economics(t))
                if number(worth) and worth > 0:
                    sources.append({'kind': 'comparable_quote', 'quality': 'documented_quote', 'source': ref,
                                    'lo': worth * 0.9, 'hi': worth * 1.1, 'center': worth, 'weight': 1.0})
                    atoms.append({'ids': (ref,), 'issue': 'comparable', 'specific': False,
                                  'text': f'The available outside quote ({ref}) has complete terms '
                                          f'{canonical(quote)}.'})
            else:
                self.note('objective_source_excluded', supplier=t.sid, ref=ref, reason='unlike_risk_or_coverage')
        if not sources:
            initial = self._initial[t.sid]
            cost = initial.get('full_cost')
            basis = str(initial.get('basis') or '')
            if number(cost) and cost > 0 and not re.search(r'share|other supplier|rival', basis, re.I):
                value = cost / divisor
                sources.append({'kind': 'initial_estimate_fallback', 'quality': 'explicitly_uncertain',
                                'source': basis, 'lo': value * 0.75, 'hi': value * 1.25,
                                'center': value, 'weight': 1.0})
                costs.append((cost * 0.75, cost * 1.25, cost))
        if not sources:
            t.est = {}
            self.note('objective_no_fair_source', supplier=t.sid)
            return None
        center = max(lower, self._median([(x['center'], x['weight']) for x in sources]))
        interval = (max(lower, min(x['lo'] for x in sources)), max(center, max(x['hi'] for x in sources)))
        cost_band = (min(x[0] for x in costs), max(x[1] for x in costs)) if costs else None
        if costs:
            t.est = {**self._economics(t), 'full_cost': self._median([(x[2], 1.0) for x in costs]),
                     'floor': min(x[0] for x in costs), 'basis': 'objective own/applicable uncertain sources'}
        else:
            t.est = {}  # Missing full-cost evidence must not fabricate a relationship penalty.
        fair = {'sources': sources, 'interval': interval, 'center': center,
                'quality': tuple(x['quality'] for x in sources), 'direct': own, 'atoms': atoms,
                'cost_band': cost_band}
        self._states[t.sid]['cost_band'] = cost_band
        self.note('objective_fair_value', supplier=t.sid, sources=sources, interval=interval, center=center,
                  cost_band=cost_band, margin_pct=margin, target_c_diagnostic=self.target_c,
                  disagreement=max(x['lo'] for x in sources) > min(x['hi'] for x in sources))
        return fair

    def _structures(self, t, until, condition):
        fields = [f for f in self.case['negotiable'] if f != 'unit_price']
        options = self.case.get('term_options', {})
        base = thaw(complete_offer(self.case, closing_terms(self.case, {'unit_price': 1.0}, t.std)))
        choices = [[thaw(o) for o in (options.get(f) or [base.get(f)])] for f in fields]
        size = math.prod(len(c) for c in choices)
        seen = set()

        def emit(raw):
            candidate = thaw(complete_offer(self.case, raw))
            candidate.update(condition)
            key = canonical({f: candidate.get(f) for f in fields})
            if key in seen or len(seen) >= CATALOGUE_LIMIT or time.perf_counter() >= until:
                return None
            seen.add(key)
            return candidate

        if size <= CATALOGUE_LIMIT:
            for combo in itertools.product(*choices):
                sheet = emit({**base, **dict(zip(fields, combo))})
                if sheet:
                    yield sheet
            return
        seeds = [thaw(sh.get('terms') or {}) for sh in t.sheets]
        seeds += [base, {**base, 'volume_per_year': self.b['need_per_year'],
                         'contract_months': round(12 * self.b['horizon_years'])}]
        for seed in seeds:
            sheet = emit(seed)
            if sheet:
                yield sheet
        # Preserve clause and explicitly mentioned options before filling the bounded beam.
        text = t.last.get('body') or ''
        representatives = []
        for field, values in zip(fields, choices):
            for value in values:
                mention = isinstance(value, str) and value and value.lower() in text.lower()
                if isinstance(value, Mapping):
                    series = value.get('series') or ''
                    mention = bool(series and str(series).lower() in text.lower())
                priority = 0 if field == 'index_clause' else (1 if mention else 2)
                representatives.append((priority, field, value))
        for _priority, field, value in sorted(representatives, key=lambda item: item[0]):
            sheet = emit({**base, field: value})
            if sheet:
                yield sheet
        for width in (2, 3):
            for indices in itertools.combinations(range(len(fields)), width):
                for values in itertools.product(*(choices[i] for i in indices)):
                    sheet = emit({**base, **{fields[i]: v for i, v in zip(indices, values)}})
                    if sheet:
                        yield sheet
                    if len(seen) >= CATALOGUE_LIMIT or time.perf_counter() >= until:
                        return

    def _price(self, t, structure, cash):
        estimate = self._economics(t)
        try:
            v1 = supplier_value(self.case, {**structure, 'unit_price': 1.0}, estimate)
            v2 = supplier_value(self.case, {**structure, 'unit_price': 2.0}, estimate)
            slope = v2 - v1
            if not number(slope) or slope <= 0:
                return None
            p = 1 + (cash - v1) / slope
            if not number(p) or p <= 0:
                return None
            options = self.case.get('term_options', {}).get('unit_price')
            if options:
                allowed = [o for o in options if number(o) and o > 0
                           and supplier_value(self.case, {**structure, 'unit_price': o}, estimate) >= cash]
                if not allowed:
                    return None
                p = min(allowed)
            else:
                # The published protocol rounds continuous prices to cents, not an invented grid.
                p = math.ceil(p * 100 - 1e-9) / 100
            normalized = thaw(complete_offer(self.case, {**structure, 'unit_price': p}))
            if normalized.get('unit_price') != p:
                return None
            row = self._candidate(t, normalized)
            if row:
                row['cash'] = supplier_value(self.case, row['terms'], estimate)
                row['desired_cash'] = cash
            return row
        except (TypeError, ValueError, KeyError, ZeroDivisionError, OverflowError):
            return None

    def _plan(self, t, condition=None):
        s = self._states[t.sid]
        started = time.perf_counter()
        until = started + max(0.0, PLAN_SECONDS - s['planning_spent'])
        if until <= started:
            return None, None
        fair = self._fair(t, until)
        best, count = None, 0
        if fair and time.perf_counter() < until:
            for structure in self._structures(t, until, condition or {}):
                if time.perf_counter() >= until:
                    break
                row = self._price(t, structure, fair['center'])
                count += 1
                if row and (best is None or self._rank(row) < self._rank(best)):
                    best = row
        s['planning_spent'] += time.perf_counter() - started
        self.note('objective_package_selection', supplier=t.sid, evaluated=count, selected=best,
                  planning_seconds=s['planning_spent'], capped=time.perf_counter() >= until,
                  condition=condition or {})
        return fair, best

    def _wave_left(self):
        return self.deadline - time.time()

    def _turn_left(self, t):
        s = self._states[t.sid]
        return s['turn_deadline'] - time.time()

    def _admit(self, t, mirror=False):
        s = self._states[t.sid]
        reserve = 3 if mirror else 4
        wave = SUPPLIER_WAIT + CLOSE_RESERVE + 10 + (0 if mirror else SUPPLIER_WAIT)
        return (not self._stop and not s['uncertain'] and not t.closed
                and (mirror or self._closing is None)
                and self._turn_left(t) > DISPATCH_RESERVE and self._wave_left() > wave
                and s['outbound'] + reserve <= self._limit
                and (mirror or s['bargaining'] < 2))

    def _claims(self, t, atoms, proposed):
        '''Called under the common lock immediately before the counted dispatch.'''
        selected, refs = [], []
        for atom in sorted(atoms, key=lambda a: not a['specific']):
            ids = tuple(dict.fromkeys(atom['ids']))
            if not ids or any(not r or r in self._spent or r in self._reserved for r in ids):
                continue
            if not atom['specific'] and t.sid != self._generic_owner:
                owner = self._states[self._generic_owner]
                if not owner['first']:
                    continue
            if len(selected) >= 3 or len(refs) + len(ids) > 3 or len(self._spent) + len(ids) > 3:
                continue
            selected.append(atom['text'])
            refs.extend(ids)
            self._reserved.update(ids)
            self._spent.update(ids)  # Uncertain delivery never refunds a claim.
        if not self._rival_used and len(refs) < 3 and len(self._spent) < 3:
            now = time.time()
            rivals = [r for r in self._portfolio if r['supplier'] != t.sid and r['primary']
                      and r['C'] < proposed['C']]
            for rival in sorted(rivals, key=self._rank):
                owner = self._states[rival['supplier']]
                if (owner['in_flight'] or owner['uncertain'] or owner['revision'] != rival['revision']
                        or now - owner['authoritative_at'] > READ_INTERVAL
                        or owner['turn_deadline'] - now <= DISPATCH_RESERVE):
                    continue
                ref = rival['id']
                if ref in self._spent:
                    continue
                selected.append(f'Another supplier currently proposes {canonical(rival["terms"])} ({ref}). '
                                'We compare complete contracts, not nominal prices; no award has been promised.')
                refs.append(ref)
                self._reserved.add(ref)
                self._spent.add(ref)
                self._rival_used = True
                break
        return selected, refs

    def _dispatch(self, t, row, body, atoms=(), mirror=False):
        terms = self._legal(t, row['terms'])
        if terms is None or self._candidate(t, terms) is None:
            return False
        s = self._states[t.sid]
        with self._changed:
            if not self._admit(t, mirror):
                admitted = False
            else:
                admitted = True
                claims, refs = self._claims(t, atoms, row)
                s['outbound'] += 1
                s['in_flight'] = True
                s['pending_key'] = self._key(t.last)
                s['uncertain'] = True
                if mirror:
                    s['mirror_used'] = True
                else:
                    s['bargaining'] += 1
                    if s['bargaining'] == 2:
                        s['revision_used'] = True
                t.rounds += 1
                msg = {'subject': self.case.get('title') or 'Settlement proposal',
                       'body': '\n\n'.join(['Hello,', body, *claims,
                                             'Complete proposed terms: ' + canonical(terms), *SIGN]),
                       'refs': refs, 'term_sheets': [{'terms': terms}]}
                self._changed.notify_all()
        if not admitted:
            self.note('objective_admission_refused', supplier=t.sid, mirror=mirror,
                      wave_left=self._wave_left(), turn_left=self._turn_left(t), outbound=s['outbound'])
            return False
        self.note('objective_dispatch', supplier=t.sid, mirror=mirror, terms=terms, C=row['C'],
                  conservative=row['conservative'], refs=refs, outbound=s['outbound'],
                  wave_left=self._wave_left(), turn_left=self._turn_left(t), in_flight=True)
        started = time.time()
        try:
            response = self.send(t, msg)
            self.note('objective_supplier_response', supplier=t.sid, response=thaw(response),
                      duration=time.time() - started)
        except Exception:
            self.note('objective_dispatch_error', supplier=t.sid, error=traceback.format_exc(),
                      duration=time.time() - started)
        finally:
            # A fresh history, not the POST's arrival time, resolves an ambiguous delivery.
            resolved = self.resync(t, refresh_clock=False)
            with self._changed:
                s['in_flight'] = False
                s['first'] = s['first'] or resolved
                s['phase'] = 'response' if resolved else 'uncertain'
                self._changed.notify_all()
            self._publish(t)
        return True

    def _revision(self, t):
        s = self._states[t.sid]
        posted, fair = s['posted'], s['fair']
        rows = self._standing(t)
        primary = next((r for r in rows if r['primary']), None)
        if not posted or s['revision_used'] or t.status in ('agreed', 'final_offer'):
            return None
        if primary and primary['conservative'] <= posted['conservative']:
            return None
        if rows and not rows[0]['primary'] and (not primary or self._rank(rows[0]) < self._rank(primary)):
            return None
        text = t.last.get('body') or ''
        accepts = False
        for sentence in re.split(r'[.!?\n]', text):
            if (MIDPOINT.search(sentence) and re.search(r'\b(agree|accept|yes|agreed|accepted)\b', sentence, re.I)
                    and not re.search(r'\b(no|not|cannot|reject|never)\b|won.t', sentence, re.I)):
                accepts = True
        s['mediation_accepted'] = accepts
        same = bool(primary and self._nonprice(t, primary['terms']) == self._nonprice(t, posted['terms']))
        self.note('objective_mediation_eligibility', supplier=t.sid, explicit_acceptance=accepts,
                  same_complete_nonprice_terms=same, status=t.status, revision_used=s['revision_used'])
        own = self._own_direct(t)
        changed_direct = bool(own and (not fair.get('direct') or own[0] != fair['direct'][0]))
        condition = {}
        if primary and CONDITION.search(text):
            for field in self.case['negotiable']:
                if field != 'unit_price' and primary['terms'].get(field) != posted['terms'].get(field):
                    condition[field] = primary['terms'][field]
        if changed_direct or condition:
            revised_fair, row = self._plan(t, condition)
            if row and canonical(row['terms']) != canonical(posted['terms']):
                fallback = min((r['conservative'] for r in rows), default=math.inf)
                if row['conservative'] >= fallback:
                    self.note('objective_revision_unneeded', supplier=t.sid, reason='standing_deal_is_better')
                    return None
                s['fair'] = revised_fair
                self.note('objective_changed_evidence', supplier=t.sid, previous_direct=fair.get('direct'),
                          new_direct=own, explicit_condition=condition)
                reason = ('We have recalculated only the newly supplied cost input in your response.'
                          if changed_direct else 'We have recalculated only the explicit contract condition in your response.')
                return row, reason + ' This is our single evidence-based revision.', revised_fair['atoms']
            return None
        if accepts and same and primary and s['planning_spent'] < PLAN_SECONDS:
            started = time.perf_counter()
            counter = supplier_value(self.case, primary['terms'], self._economics(t))
            original = s['original_cash']
            midpoint = (original + counter) / 2
            row = self._price(t, posted['terms'], midpoint) if counter > original else None
            s['planning_spent'] += time.perf_counter() - started
            with self._lock:
                fallback = min((r['conservative'] for r in self._portfolio), default=math.inf)
            if row and row['conservative'] <= fallback and s['planning_spent'] <= PLAN_SECONDS:
                self.note('objective_midpoint', supplier=t.sid, original_cash=original,
                          counter_cash=counter, midpoint_cash=midpoint, solved=row, fallback=fallback)
                return row, ('Following your explicit acceptance of the midpoint procedure, this single revision '
                             'uses the arithmetic midpoint in supplier cash value on the unchanged complete '
                             'non-price terms. Any award remains subject to our final confirmation.'), ()
            self.note('objective_midpoint_rejected', supplier=t.sid, midpoint=midpoint,
                      reason='budget_fallback_or_planning_guard')
        return None

    def _ready(self, t):
        self._publish(t)
        with self._changed:
            s = self._states[t.sid]
            s['phase'], s['first'] = 'ready', True
            self._changed.notify_all()
        rows = s['safe']
        self.note('objective_ready', supplier=t.sid, exchanges=s['bargaining'], revision_used=s['revision_used'],
                  safe_options=thaw(rows), observed_savings=(s['opening_C'] - rows[0]['C']) if rows else None,
                  incremental_savings_not_observed=True)

    def _close_owned(self, t, nomination):
        s = self._states[t.sid]
        returned = None
        started = time.time()
        try:
            if nomination == 'walk':
                with self._changed:
                    if self._walk_used or self._stop or s['in_flight']:
                        raise RuntimeError('walk ownership guard')
                    self._walk_used = True
                    s['outbound'] += 1
                    s['in_flight'] = True
                returned = self.walk()
            else:
                if not self.resync(t, refresh_clock=False):
                    raise RuntimeError('closing read unresolved')
                self._publish(t)
                selected = next((r for r in s['safe'] if r['id'] == nomination['id']
                                 and r['terms'] == nomination['terms']), None)
                if not selected:
                    raise RuntimeError('elected offer changed')
                if not selected['primary']:
                    if s['mirror_used']:
                        raise RuntimeError('mirror already used')
                    if not self._dispatch(t, selected,
                                          'Please confirm the complete alternative you proposed, exactly as shown. '
                                          'Any award remains subject to our final confirmation.', mirror=True):
                        raise RuntimeError('mirror guard refused')
                    primary = next((r for r in self._standing(t) if r['primary']), None)
                    if not primary or primary['terms'] != selected['terms']:
                        self.note('objective_mirror_changed', supplier=t.sid, expected=selected, actual=primary)
                        raise RuntimeError('mirror did not produce the exact executable primary')
                    selected = primary
                if self._wave_left() <= DISPATCH_RESERVE or self._turn_left(t) <= DISPATCH_RESERVE:
                    raise RuntimeError('acceptance time reserve exhausted')
                with self._changed:
                    if self._stop or s['outbound'] + 2 > self._limit:
                        raise RuntimeError('acceptance slots exhausted')
                    identity = (t.sid, selected['id'])
                    if identity in self._attempted:
                        raise RuntimeError('offer already attempted')
                    self._attempted.add(identity)
                    s['outbound'] += 1
                    s['accept_started'], s['accept_retry'], s['in_flight'] = True, False, True
                self.note('objective_accept', supplier=t.sid, offer=selected['id'], C=selected['C'],
                          revision=t.event_revision, outbound=s['outbound'])
                sheet = next(sh for sh in t.sheets if sh.get('term_sheet_id') == selected['id'])
                returned = self.close(t, sheet)
        except Exception:
            self.note('objective_close_error', supplier=t.sid, error=traceback.format_exc())
            t.state_uncertain = True
        finally:
            with self._changed:
                s['accept_started'] = False
                s['in_flight'] = False
                s['phase'] = 'await_terminal'
                self._close_outcome = {'returned': returned, 'finished': time.time(), 'supplier': t.sid}
                self._changed.notify_all()
            self.note('objective_close_return', supplier=t.sid, returned=thaw(returned),
                      duration=time.time() - started, confirmation_pending=True)

    def _worker(self, t):
        s = self._states[t.sid]
        try:
            while True:
                try:
                    with self._changed:
                        if self._stop:
                            return
                        command = self._closing
                        phase = s['phase']
                    if command and command[0] == t.sid:
                        if phase != 'await_terminal':
                            self._close_owned(t, command[1])
                        with self._changed:
                            self._changed.wait(0.25)
                        continue
                    if phase == 'initial':
                        if not self.resync(t, refresh_clock=False):
                            s['phase'] = 'uncertain'
                            self._publish(t)
                            continue
                        self._publish(t)
                        fair, row = self._plan(t)
                        s['fair'], s['posted'] = fair, row
                        if row:
                            s['original_cash'] = row['cash']
                            body = ('We propose this complete package using estimated supplier cash value at standard '
                                    'terms, with the stated sustainable revenue margin where applicable. Documented '
                                    'direct costs are lower-bound inputs, not proof of a reservation price; weak '
                                    'estimates retain uncertainty. The specified commitment and contract clauses '
                                    'allocate the stated risks. If one item prevents agreement, identify it and provide '
                                    'your complete counterproposal. If we remain apart on price on otherwise identical '
                                    'complete terms, we can consider one arithmetic midpoint proposal in supplier cash '
                                    'value if you explicitly accept that procedure. Any award remains subject to our '
                                    'final confirmation.')
                            if self._dispatch(t, row, body, fair['atoms']):
                                continue
                        self._ready(t)
                    elif phase == 'response':
                        revision = self._revision(t)
                        if revision and self._dispatch(t, *revision):
                            # The second response is evaluated for settlement, never a third bargain.
                            self._ready(t)
                        else:
                            self._ready(t)
                    elif phase in ('ready', 'uncertain', 'await_terminal'):
                        if time.time() - s['authoritative_at'] >= READ_INTERVAL:
                            resolved = self.resync(t, refresh_clock=False)
                            self._publish(t)
                            if resolved:
                                if phase == 'uncertain' and s['bargaining'] == 1:
                                    s['phase'], s['first'] = 'response', True
                                elif phase != 'await_terminal':
                                    self._ready(t)
                        with self._changed:
                            self._changed.wait(0.5)
                except Exception:
                    self.note('objective_worker_error', supplier=t.sid, phase=s['phase'],
                              error=traceback.format_exc())
                    with self._changed:
                        s['phase'], s['uncertain'], s['in_flight'] = 'uncertain', True, False
                        self._changed.notify_all()
                        self._changed.wait(0.5)
        except BaseException:
            self.note('objective_worker_failed', supplier=t.sid, error=traceback.format_exc())
            raise
        finally:
            with self._changed:
                s['done'] = True
                self._changed.notify_all()

    def _session_observation(self, reply, started, revisions):
        if reply.get('status') == 'ended' and isinstance(reply.get('result'), Mapping):
            result = thaw(reply['result'])
            if 'deal' in result:
                with self._changed:
                    self._confirmed, self._stop = result, True
                    self._changed.notify_all()
                self.note('objective_terminal_confirmed', result=result)
                return
        clocks = {}
        seconds = reply.get('seconds_left')
        if isinstance(seconds, Mapping):
            clocks.update(seconds)
        elif number(seconds):
            self.deadline = min(self.deadline, started + max(0.0, seconds))
        threads = reply.get('threads')
        if isinstance(threads, Mapping):
            for sid, item in threads.items():
                if isinstance(item, Mapping) and number(item.get('seconds_left')):
                    clocks[sid] = item['seconds_left']
        elif isinstance(threads, (list, tuple)):
            for item in threads:
                if isinstance(item, Mapping) and item.get('supplier_id') in self._states:
                    if number(item.get('seconds_left')):
                        clocks[item['supplier_id']] = item['seconds_left']
        with self._changed:
            for sid, seconds in clocks.items():
                if isinstance(seconds, Mapping):
                    seconds = seconds.get('seconds_left')
                if sid not in self._states or not number(seconds):
                    continue
                s = self._states[sid]
                if s['in_flight'] or revisions.get(sid) != s['revision']:
                    continue  # A read begun before a new response cannot reset its clock.
                s['turn_deadline'] = started + max(0.0, seconds)
                s['clock_observed'] = started
            outcome = self._close_outcome
            if outcome and started > outcome['finished'] and self._closing:
                # An authoritative nonterminal session read is required before another close election.
                self._closing = None
                s = self._states[outcome['supplier']]
                s['phase'], s['uncertain'] = 'uncertain', True
                self._changed.notify_all()
        self.note('objective_session_clock', clocks=thaw(clocks), wave_left=self._wave_left(),
                  read_started=started, status=reply.get('status'))

    def _elect(self):
        now = time.time()
        with self._changed:
            if self._stop or self._closing:
                return None
            all_first = all(s['first'] or s['done'] for s in self._states.values())
            eligible = []
            for row in self._portfolio:
                s = self._states[row['supplier']]
                if s['in_flight'] or s['uncertain'] or s['done']:
                    continue
                urgent = self._wave_left() <= SUPPLIER_WAIT + CLOSE_RESERVE + 10 or s['turn_deadline'] - now <= 30
                if s['phase'] != 'ready' and not urgent:
                    continue
                if not all_first and not urgent:
                    continue
                if not row['primary'] and (s['mirror_used'] or not self._admit(self.threads[row['supplier']], True)):
                    continue
                if row['primary'] and s['outbound'] + 2 > self._limit:
                    continue
                if (row['supplier'], row['id']) in self._attempted:
                    continue
                if math.isfinite(self.c_alt) and row['C'] >= self.c_alt:
                    continue
                eligible.append(row)
            if eligible:
                winner = min(eligible, key=self._rank)
                self._closing = (winner['supplier'], thaw(winner))
                self._close_outcome = None
                self._changed.notify_all()
                return {'owner': winner['supplier'], 'offer': winner, 'all_first': all_first}
            finished = all(s['phase'] in ('ready', 'await_terminal') or s['done'] for s in self._states.values())
            urgent = self._wave_left() <= CLOSE_RESERVE
            if not (finished or urgent) or any(s['in_flight'] for s in self._states.values()) or self._walk_used:
                return None
            safe = [r for r in self._portfolio if not math.isfinite(self.c_alt) or r['C'] < self.c_alt]
            if safe:
                return None  # Uncertain ownership is not a reason to abandon a safe unbacked deal.
            live = [t for t in self.threads.values() if t.status not in ENDED] or list(self.threads.values())
            if not live:
                return None
            owner = live[0].sid  # Match the plumbing's walk target without overlapping supplier I/O.
            if self._states[owner]['done']:
                return None
            self._closing, self._close_outcome = (owner, 'walk'), None
            self._changed.notify_all()
            return {'owner': owner, 'walk': True, 'valid_outside': math.isfinite(self.c_alt)}

    def run(self):
        '''Own the policy and portfolio supervision for both single and multiple suppliers.'''
        self._limit = int(self.case.get('round_limit') or 10)
        self._outside_terms = self._legal(None, self.alt.get('terms'))
        self.c_alt = total_cost(self.case, self._outside_terms) if self._outside_terms else math.inf
        if not number(self.c_alt):
            self.c_alt, self._outside_terms = math.inf, None
        self.note('objective_safety_start', outside_valid=self._outside_terms is not None, c_alt=self.c_alt,
                  round_limit=self._limit, request_bound_seconds=CLOSE_RESERVE,
                  transport_note='Admission reserves are local; an SDK/network request can outlive them. '
                                 'Dispatched requests are reconciled, not cancelled or duplicated.')
        ordered = list(self.threads.values())
        ordered.sort(key=lambda t: self.C(t, t.sheets[0]['terms']) if t.sheets else math.inf, reverse=True)
        if not ordered:
            self.note('objective_no_suppliers')
            return None
        self._generic_owner = ordered[0].sid
        for t in ordered:
            opening = self.C(t, t.sheets[0]['terms']) if t.sheets else math.inf
            self._states[t.sid] = {
                'phase': 'initial', 'fair': None, 'posted': None, 'original_cash': None,
                'mediation_accepted': False, 'revision_used': False, 'safe': (), 'cost_band': None,
                'status': t.status, 'revision': t.event_revision, 'in_flight': False, 'uncertain': False,
                'outbound': t.sent(), 'bargaining': 0, 'mirror_used': False, 'accept_started': False,
                'accept_retry': False, 'pending_key': None, 'planning_spent': 0.0, 'first': False,
                'done': False, 'authoritative_at': self._opened, 'clock_observed': None,
                'turn_deadline': self._opened + 60.0, 'opening_C': opening}
        workers = ThreadPoolExecutor(max_workers=len(ordered), thread_name_prefix='objective-supplier')
        reads = ThreadPoolExecutor(max_workers=1, thread_name_prefix='objective-session')
        futures = {workers.submit(self._worker, t): t.sid for t in ordered}
        observed = set()
        poll, poll_started, revisions, next_poll = None, 0.0, {}, 0.0
        try:
            while not self._stop:
                now = time.time()
                if poll is None and now >= next_poll:
                    poll_started = now
                    with self._lock:
                        revisions = {sid: s['revision'] for sid, s in self._states.items()}
                    poll = reads.submit(self.c.session, self.sid)
                if poll is not None and poll.done():
                    try:
                        self._session_observation(poll.result(), poll_started, revisions)
                    except Exception:
                        self.note('objective_session_read_error', error=traceback.format_exc())
                    poll, next_poll = None, time.time() + 1.0
                for future, sid in futures.items():
                    if future.done() and future not in observed:
                        observed.add(future)
                        try:
                            future.result()
                            self.note('objective_worker_observed', supplier=sid, outcome='completed')
                        except BaseException:
                            self.note('objective_worker_observed', supplier=sid, outcome='failed',
                                      error=traceback.format_exc())
                if self._stop:
                    break
                elected = self._elect()
                if elected:
                    self.note('objective_close_election', **elected)
                if self._wave_left() <= 0:
                    self.note('objective_wave_exhausted', in_flight={sid: s['in_flight']
                              for sid, s in self._states.items()}, terminal_confirmed=False)
                    break
                if len(observed) == len(futures):
                    self.note('objective_all_workers_finished', confirmed=self._confirmed is not None)
                    break
                if self._walk_used and self._close_outcome and not self._closing:
                    self.note('objective_walk_unresolved', outcome=thaw(self._close_outcome))
                    break
                with self._changed:
                    self._changed.wait(0.2)
        finally:
            with self._changed:
                self._stop = True
                self._changed.notify_all()
            # Do not turn confirmed closure into a wait for an unrelated 120-second supplier.
            until = time.monotonic() + 1.0
            while time.monotonic() < until and not all(f.done() for f in futures):
                with self._changed:
                    self._changed.wait(min(0.1, max(0.0, until - time.monotonic())))
            workers.shutdown(wait=False, cancel_futures=True)
            reads.shutdown(wait=False, cancel_futures=True)
            self.note('objective_shutdown', pending_suppliers=[sid for f, sid in futures.items() if not f.done()],
                      session_read_pending=bool(poll and not poll.done()),
                      exchanges={sid: s['bargaining'] for sid, s in self._states.items()})
        if self._confirmed is not None:
            return self._confirmed
        outcome = self._close_outcome
        returned = outcome.get('returned') if outcome else None
        if returned is not None and self.terminal_result(returned) is not None:
            self.note('objective_terminal_transport_result', session_confirmation_unavailable=True)
            return returned
        self.note('objective_unresolved', acceptance_or_read_may_still_be_in_flight=True)
        return None
