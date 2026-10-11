"""Session-local Bayesian bargaining, with an independent protocol supervisor."""

import itertools
import json
import math
import random
import re
import threading
import time
import traceback
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation

from arena_kit import complete_offer, must_haves_ok, total_cost
from arena_kit.cost import closing_terms, supplier_value
from proto.engine import ENDED, SIGN, fmt
from proto.practice import PracticeNegotiator


STYLES = ("responsive", "price-rigid/terms-flexible", "commitment-seeking", "near-final")
N = 256
SEED = 731


def thaw(value):
    if isinstance(value, Mapping):
        return {k: thaw(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [thaw(v) for v in value]
    return value


def key(value):
    return json.dumps(thaw(value), sort_keys=True, separators=(",", ":"), default=str)


def sigmoid(x):
    x = max(-40.0, min(40.0, x))
    return 1.0 / (1.0 + math.exp(-x))


def entropy(probabilities):
    return -sum(p * math.log(p) for p in probabilities if p > 0)


def bounded(x, lo, hi):
    return max(lo, min(hi, x))


class ComputeCap(Exception):
    pass


class Negotiator(PracticeNegotiator):
    def __init__(self, *args, **kwargs):
        self._born = time.time()
        super().__init__(*args, **kwargs)
        if self.deadline is None:
            self.deadline = self._born + 480

    def styled(self, t, msg):
        # This strategy has no writer calls, even when the base variant has one.
        return msg

    def prepare_message(self, t, msg):
        # Planning state and attachments must never cross the protocol boundary.
        return {k: thaw(msg[k]) for k in ("subject", "body", "refs", "term_sheets")}

    def _cost_residual_message(self, t, msg):
        return msg

    def _canonical(self, t, terms, price=False):
        out = thaw(closing_terms(self.case, thaw(terms), thaw(t.std)))
        if not price:
            out.pop("unit_price", None)
        return key(out)

    def _cap(self, t, q):
        wanted = self._canonical(t, q)
        prices = []
        for sheet in t.sheets:
            terms = sheet.get("terms") or {}
            p = terms.get("unit_price")
            if isinstance(p, (int, float)) and not isinstance(p, bool) and math.isfinite(p) and p > 0:
                if self._canonical(t, terms) == wanted:
                    prices.append(p)
        return min(prices, default=math.inf)

    def _terms(self, t, terms, proposing=False, budget=True):
        try:
            raw = thaw(terms)
            if not isinstance(raw, dict):
                return None
            std = thaw(t.std) if t is not None else None
            q = thaw(complete_offer(self.case, closing_terms(self.case, raw, std)))
            fields = set(self.case["negotiable"])
            if set(q) != fields:
                return None
            p = q.get("unit_price")
            if not isinstance(p, (int, float)) or isinstance(p, bool) or not math.isfinite(p) or p <= 0:
                return None
            # A standing sheet is not permission to accept a snapped, different bargain.
            if not proposing and any(f in raw and raw[f] != q[f] for f in fields):
                return None
            options = self.case.get("term_options") or {}
            for f in fields:
                allowed = options.get(f)
                if allowed and not any(q[f] == thaw(o) for o in allowed):
                    return None
            for f, value in (self.case.get("fixed_terms") or {}).items():
                if f in q and q[f] != thaw(value):
                    return None
            if not must_haves_ok(self.case, q, std):
                return None
            if proposing and t is not None and p > self._cap(t, q):
                return None
            c = self.C(t, q) if t is not None else total_cost(self.case, q)
            if not math.isfinite(c) or (budget and c > self.c_alt):
                return None
            if proposing and any(f in raw and raw[f] != q[f] for f in fields):
                self.note("bayes_normalization_approved", supplier=t.sid, proposed=raw, normalized=q, C=c)
            return q, c
        except (TypeError, ValueError, KeyError, ZeroDivisionError, OverflowError):
            return None

    def _supplier(self, t):
        sup = thaw(t.est)
        opening = thaw(t.opening_terms)
        sup["standard"] = thaw(closing_terms(self.case, opening, sup.get("standard") or t.std))
        rate = sup.get("interest_rate")
        if not isinstance(rate, (int, float)) or not math.isfinite(rate):
            rate = self.b.get("interest_rate") or 0.0
        sup["interest_rate"] = bounded(float(rate), 0.0, 0.5)
        sup["usual_rate"] = sup["interest_rate"]
        return sup

    def _new_model(self, t):
        rng = random.Random(SEED)
        opening = thaw(t.opening_terms)
        o = opening.get("unit_price")
        if not isinstance(o, (int, float)) or not math.isfinite(o) or o <= 0:
            raise ValueError("missing immutable opening unit price")
        sup = self._supplier(t)
        dims = []
        for f in self.case["negotiable"]:
            if f != "unit_price":
                for option in (self.case.get("term_options") or {}).get(f) or []:
                    dims.append((f, thaw(option)))
        basis = str(t.est.get("basis") or "").lower()
        documented = "own cost breakdown" in basis or "this supplier" in basis
        weak = any(s in basis for s in ("other supplier", "% share", "lowest opening", "85 %"))
        mixture = 0.55 if documented and not weak else 0.12 if weak else 0.25
        floor = t.est.get("floor")
        margin = bounded(float(self.b.get("sustainable_margin_pct") or 5) / 100, 0.0, 0.4)
        centre = floor / o / (1 - margin) if isinstance(floor, (int, float)) and floor > 0 else 0.8
        centre = bounded(centre, 0.15, 1.12)
        particles = []
        for i in range(N):
            style = STYLES[i % len(STYLES)]
            r = rng.gauss(centre, 0.065 if documented and not weak else 0.14) if rng.random() < mixture else rng.uniform(0.25, 1.08)
            width = 0.12 if style == "price-rigid/terms-flexible" else 0.075
            particles.append({"r": bounded(r, 0.05, 1.35), "tau": rng.uniform(0.015, 0.09),
                              "w": [rng.gauss(0.0, width) for _ in range(len(dims) + 4)],
                              "a": rng.uniform(0.1, 1.8), "e": rng.uniform(0.0, 1.5),
                              "h": rng.uniform(0.4, 2.2), "style": style,
                              "rate": bounded(rng.gauss(sup["interest_rate"], 0.025), 0.0, 0.5),
                              "log": -math.log(N)})
        model = {"rng": rng, "opening": float(o), "supplier": sup, "dims": dims,
                 "particles": particles, "conditions": [], "seen": set(), "history": [],
                 "pending": None, "last_action": None, "last_quote": None, "error": None}
        self.note("bayes_prior", supplier=t.sid, basis=basis, documented=documented,
                  weak_prior=weak, concentrated_weight=mixture, reservation_centre=centre * o)
        return model

    def _weights(self, model):
        logs = [p["log"] for p in model["particles"]]
        maximum = max(logs)
        if not math.isfinite(maximum):
            raise ValueError("nonfinite posterior")
        values = [math.exp(v - maximum) for v in logs]
        z = sum(values)
        if not math.isfinite(z) or z <= 0:
            raise ValueError("collapsed posterior")
        return [v / z for v in values]

    def _quantile(self, values, weights, probability):
        cumulative = 0.0
        for value, weight in sorted(zip(values, weights)):
            cumulative += weight
            if cumulative >= probability:
                return value
        return max(values)

    def _normalise(self, t, model):
        try:
            weights = self._weights(model)
        except ValueError:
            fresh = self._new_model(t)
            for field in ("conditions", "seen", "history", "pending", "last_action", "last_quote"):
                fresh[field] = model[field]
            model.clear()
            model.update(fresh)
            self.note("model_failure", supplier=t.sid, recovery="broad_prior_mixture")
            return
        for p, weight in zip(model["particles"], weights):
            p["log"] = math.log(max(weight, 1e-300))
        ess = 1.0 / sum(w * w for w in weights)
        if ess >= N / 2:
            return
        rng = model["rng"]
        cumulative = list(itertools.accumulate(weights))
        offset, index = rng.random() / N, 0
        fresh = []
        for i in range(N):
            position = offset + i / N
            while index < N - 1 and cumulative[index] < position:
                index += 1
            source = model["particles"][index]
            p = {**source, "w": [bounded(w + rng.gauss(0, 0.008), -0.5, 0.5) for w in source["w"]]}
            p["r"] = bounded(p["r"] + rng.gauss(0, 0.012), 0.05, 1.35)
            p["tau"] = bounded(p["tau"] * math.exp(rng.gauss(0, 0.08)), 0.006, 0.18)
            for f, lo, hi, scale in (("a", 0, 3, 0.05), ("e", 0, 3, 0.05), ("h", 0.1, 4, 0.05), ("rate", 0, 0.5, 0.005)):
                p[f] = bounded(p[f] + rng.gauss(0, scale), lo, hi)
            if rng.random() < 0.02:
                p["style"] = rng.choice(STYLES)
            p["log"] = -math.log(N)
            fresh.append(p)
        model["particles"] = fresh
        self.note("bayes_resample", supplier=t.sid, effective_sample_size=ess)

    def _met(self, condition, terms):
        value = terms.get(condition["field"])
        try:
            if condition["op"] == ">=":
                return value is not None and value >= condition["value"]
            if condition["op"] == "<=":
                return value is not None and value <= condition["value"]
            return value == condition["value"]
        except TypeError:
            return False

    def _phi(self, t, model, q):
        std = closing_terms(self.case, thaw(t.opening_terms), thaw(t.opening_std))
        values = [float(q.get(f) == option) - float(std.get(f) == option) for f, option in model["dims"]]
        for group in (("contract_months",), ("volume_per_year",), ("index_clause",), ("ppm_commitment", "lead_time_days")):
            conditions = [c for c in model["conditions"] if c["field"] in group]
            values.append(float(bool(conditions) and all(self._met(c, q) for c in conditions)))
        return values

    def _cash(self, model, q):
        sup = model["supplier"]
        rate = sup["interest_rate"]
        v = supplier_value(self.case, q, sup) / model["opening"]
        other = {**sup, "interest_rate": rate + 0.01}
        gradient = (supplier_value(self.case, q, other) / model["opening"] - v) / 0.01
        return v, gradient

    def _features(self, t, model, q, evidence=0.0):
        cash = self._cash(model, q)
        old = model["last_action"]
        previous = self._cash(model, old["terms"])[0] if old else cash[0]
        movement = bounded(20 * max(0.0, cash[0] - previous), 0, 1)
        quote = model["last_quote"]
        quoted = self._cash(model, quote)[0] if quote else 1.0
        finality = bool(t.status == "final_offer" or re.search(r"\b(?:final offer|no further concessions|last offer)\b", t.last.get("body") or "", re.I))
        conditions = model["conditions"]
        met = sum(self._met(c, q) for c in conditions) / len(conditions) if conditions else 0.0
        return {"terms": q, "cash": cash, "phi": self._phi(t, model, q), "movement": movement,
                "evidence": evidence, "met": met, "has_conditions": bool(conditions),
                "demand": max(0.0, quoted - cash[0]), "finality": finality}

    def _probabilities(self, model, features):
        base_rate = model["supplier"]["interest_rate"]
        result = []
        for p in model["particles"]:
            worth = features["cash"][0] + features["cash"][1] * (p["rate"] - base_rate)
            preference = sum(w * x for w, x in zip(p["w"], features["phi"]))
            movement = features["movement"] * p["a"]
            if p["style"] == "price-rigid/terms-flexible":
                movement *= 0.25
            commitment = 0.0
            if p["style"] == "commitment-seeking" and features["has_conditions"]:
                commitment = 1.2 * (2 * features["met"] - 1)
            buffer = 0.018 if p["style"] == "near-final" else 0.0
            accept = sigmoid((worth + preference - p["r"] - buffer) / p["tau"] + movement + p["e"] * features["evidence"] + commitment)
            walk = sigmoid(-5.2 + p["h"] * (8 * features["demand"] / (1 + features["evidence"]) + 1.2 * features["finality"]))
            result.append(((1 - walk) * accept, (1 - walk) * (1 - accept), walk))
        return result

    def _quote_log(self, model, offered, quote, p, final=False):
        rate = p["rate"] - model["supplier"]["interest_rate"]
        cash = quote["cash"][0] + rate * quote["cash"][1]
        preference = sum(w * x for w, x in zip(p["w"], quote["phi"]))
        previous = offered["previous_cash"] if offered is not None else 1.0
        share = {"responsive": 0.30, "price-rigid/terms-flexible": 0.65, "commitment-seeking": 0.45, "near-final": 0.10}[p["style"]]
        buffer = 0.025 if p["style"] in ("near-final", "price-rigid/terms-flexible") else 0.01
        location = p["r"] - preference + buffer
        if not final:
            location += share * max(0.0, previous - location)
        scale = max(0.012, p["tau"] * (0.55 if final else 1.4))
        residual = (cash - location) / scale
        # Heavy tails deliberately prevent treating a counter as a hidden floor.
        return -2 * math.log1p(residual * residual / 3) - math.log(scale)

    def _extract_conditions(self, t, model, message):
        text = message.get("body") or ""
        identity = t._key(message)
        patterns = (
            ("contract_months", ">=", r"\b(?:require|need|must have)\s+(?:a\s+)?(\d+)\s*[- ]month\s+(?:contract|commitment)\b"),
            ("volume_per_year", ">=", r"\b(?:require|need|must have)\s+(?:at least\s+)?([\d,]+)\s+units\s+(?:per year|annually)\b"),
            ("payment_days", "<=", r"\b(?:require|need|must have)\s+payment\s+(?:within|in)\s+(\d+)\s+days\b"),
            ("ppm_commitment", "==", r"\b(?:require|need|must maintain)\s+(?:a\s+)?(\d+)\s+ppm\s+(?:commitment|limit)\b"),
        )
        found = []
        for field, op, pattern in patterns:
            if field not in self.case["negotiable"]:
                continue
            for match in re.finditer(pattern, text, re.I):
                found.append({"field": field, "op": op, "value": int(match[1].replace(",", "")),
                              "span": [match.start(), match.end()], "text": match[0], "message": identity})
        sheets = message.get("term_sheets") or []
        if sheets and "index_clause" in self.case["negotiable"]:
            clause = (sheets[0].get("terms") or {}).get("index_clause")
            if clause is not None:
                for match in re.finditer(r"\b(?:must maintain|require|must keep)\s+(?:the\s+)?index clause\b", text, re.I):
                    found.append({"field": "index_clause", "op": "==", "value": thaw(clause),
                                  "span": [match.start(), match.end()], "text": match[0], "message": identity})
        for condition in found:
            model["conditions"] = [c for c in model["conditions"] if c["field"] != condition["field"]]
            model["conditions"].append(condition)
        if found:
            self.note("bayes_explicit_conditions", supplier=t.sid, extracted=found, unmatched_text="unknown")

    def _observe(self, t, model):
        for message in t.events:
            identity = t._key(message)
            if identity in model["seen"]:
                continue
            model["seen"].add(identity)
            model["history"].append(thaw(message))
            if message.get("from") == "buyer":
                continue
            offered = model["pending"]
            conditions_before = list(model["conditions"])
            self._extract_conditions(t, model, message)
            sheets = message.get("term_sheets") or []
            valid = self._terms(t, (sheets[0].get("terms") or {}), budget=False) if sheets else None
            quote = self._features(t, model, valid[0]) if valid else None
            status = message.get("status")
            probabilities = self._probabilities(model, offered) if offered else None
            weights = self._weights(model)
            outcome = 2 if status in ENDED else 0 if status == "agreed" else 1
            if probabilities:
                predicted = sum(w * ps[outcome] for w, ps in zip(weights, probabilities))
                model["error"] = (1 - predicted) ** 2
            body = (message.get("body") or "").lower()
            for i, p in enumerate(model["particles"]):
                likelihood = 0.0
                if probabilities:
                    likelihood += math.log(max(probabilities[i][outcome], 1e-12))
                if quote:
                    likelihood += (0.75 if offered else 0.12) * self._quote_log(model, offered, quote, p, status == "final_offer")
                    worth = quote["cash"][0] + quote["cash"][1] * (p["rate"] - model["supplier"]["interest_rate"])
                    preference = sum(w * x for w, x in zip(p["w"], quote["phi"]))
                    likelihood += 0.25 * math.log(max(sigmoid((worth + preference - p["r"]) / p["tau"]), 1e-12))
                    if model["last_quote"]:
                        old = self._features(t, model, model["last_quote"])
                        changed = sum(w * (a - b) for w, a, b in zip(p["w"], quote["phi"], old["phi"]))
                        likelihood += 0.2 * math.log(max(sigmoid(changed / max(p["tau"], 0.02)), 1e-12))
                if offered and conditions_before:
                    met = all(self._met(c, offered["terms"]) for c in conditions_before)
                    if p["style"] == "commitment-seeking":
                        likelihood += math.log(1.3 if met == (status == "agreed") else 0.8)
                if re.search(r"\b(?:frozen|no price reduction|price is fixed)\b", body):
                    likelihood += math.log(1.8 if p["style"] == "price-rigid/terms-flexible" else 0.9)
                if status == "final_offer":
                    likelihood += math.log(1.5 if p["style"] == "near-final" else 0.95)
                p["log"] += likelihood
            if valid:
                model["last_quote"] = valid[0]
            if offered:
                model["pending"] = None
            self._normalise(t, model)
            self.note("bayes_observation", supplier=t.sid, status=status, message=identity,
                      primary=valid[0] if valid else None, posterior_predictive_error=model["error"])

    def _diagnostics(self, model):
        weights = self._weights(model)
        values = [p["r"] * model["opening"] for p in model["particles"]]
        styles = {s: sum(w for w, p in zip(weights, model["particles"]) if p["style"] == s) for s in STYLES}
        return {"reservation_quantiles": {str(q): self._quantile(values, weights, q) for q in (0.1, 0.5, 0.9)},
                "effective_sample_size": 1 / sum(w * w for w in weights), "style_probabilities": styles,
                "posterior_predictive_error": model["error"]}

    def _structures(self, t, model, cutoff):
        fields = [f for f in self.case["negotiable"] if f != "unit_price"]
        options = self.case.get("term_options") or {}
        base = complete_offer(self.case, closing_terms(self.case, thaw(t.opening_terms), thaw(t.std)))
        choices = [[thaw(o) for o in options.get(f) or [base.get(f)]] for f in fields]
        structures, seen, protected = [], set(), set()

        def add(terms, preserve=False):
            q = thaw(complete_offer(self.case, {**base, **thaw(terms), "unit_price": model["opening"]}))
            identity = key({f: q[f] for f in fields})
            if identity not in seen:
                seen.add(identity)
                structures.append(q)
            if preserve:
                protected.add(identity)

        add(base, True)
        for sheet in t.sheets:
            add(sheet.get("terms") or {}, True)
        need = {"volume_per_year": self.b["need_per_year"], "contract_months": round(12 * self.b["horizon_years"]),
                "lead_time_days": self.b["need_lead_time_days"]}
        add(need, True)
        requested = {c["field"]: c["value"] for c in model["conditions"]}
        add(requested, True)
        product = math.prod(len(c) for c in choices)
        if product <= 256:
            for combo in itertools.product(*choices):
                add(dict(zip(fields, combo)))
        else:
            # Protect clause and explicit-condition representatives before pruning.
            for f, values in zip(fields, choices):
                for value in values:
                    add({f: value}, f == "index_clause" or f in requested)
                    if len(structures) >= 256 or time.perf_counter() >= cutoff:
                        break
                if len(structures) >= 256 or time.perf_counter() >= cutoff:
                    break
            for width in (2, 3):
                for linked in itertools.combinations(range(len(fields)), width):
                    for combo in itertools.product(*(choices[i] for i in linked)):
                        add({fields[i]: value for i, value in zip(linked, combo)})
                        if len(structures) >= 256 or time.perf_counter() >= cutoff:
                            break
                    if len(structures) >= 256 or time.perf_counter() >= cutoff:
                        break
                if len(structures) >= 256 or time.perf_counter() >= cutoff:
                    break
        scored = []
        for q in structures[:256]:
            valid = self._terms(t, q, budget=False)
            if valid:
                identity = key({f: q[f] for f in fields})
                scored.append((identity not in protected, valid[1], identity, valid[0]))
        scored.sort(key=lambda row: (row[0], row[1], row[2]))
        return [row[3] for row in scored[:32]]

    def _rank_cost(self, t, q, actual):
        if not self.relationship or not t.est.get("full_cost"):
            return actual
        costs = [actual]
        for factor, delta in ((0.9, -0.02), (1.1, 0.02)):
            sup = thaw(t.est)
            sup["full_cost"] *= factor
            sup["interest_rate"] = bounded(float(sup.get("interest_rate") or 0) + delta, 0, 0.5)
            try:
                value = total_cost(self.case, q, t.std, sup)
                if math.isfinite(value):
                    costs.append(value)
            except (ValueError, KeyError, ZeroDivisionError):
                pass
        # A modest sensitivity envelope is a ranking aid, not an acceptance ceiling.
        return actual + 0.25 * max(0.0, max(costs) - actual)

    def _actions(self, t, model, evidence, cutoff):
        weights = self._weights(model)
        groups = []
        for structure in self._structures(t, model, cutoff - 0.5):
            if time.perf_counter() > cutoff - 0.32:
                break
            o = model["opening"]
            q0 = {**structure, "unit_price": o}
            q1 = {**structure, "unit_price": 2 * o}
            phi = self._phi(t, model, q0)
            v0, g0 = self._cash(model, q0)
            v1, g1 = self._cash(model, q1)
            values = []
            for p in model["particles"]:
                dr = p["rate"] - model["supplier"]["interest_rate"]
                slope = ((v1 - v0) + (g1 - g0) * dr) / o
                intercept = v0 + g0 * dr - slope * o
                preference = sum(w * x for w, x in zip(p["w"], phi))
                values.append((p["r"] - preference - intercept) / slope if slope > 1e-12 else math.inf)
            finite = [(v, w) for v, w in zip(values, weights) if math.isfinite(v) and v > 0]
            if not finite:
                continue
            vs, ws = map(list, zip(*finite))
            z = sum(ws)
            ws = [w / z for w in ws]
            slope = (v1 - v0) / o
            prices = [self._quantile(vs, ws, probability) for probability in (0.15, 0.4, 0.65, 0.85)]
            median = self._quantile(vs, ws, 0.5)
            if slope > 1e-12:
                prices.extend(median + buffer / slope for buffer in (0.02, 0.05))
            cap = self._cap(t, structure)
            prices.append(cap if math.isfinite(cap) else o)
            group, seen = [], set()
            for price in prices:
                if not math.isfinite(price) or price <= 0 or price > cap:
                    continue
                valid = self._terms(t, {**structure, "unit_price": price}, proposing=True)
                if not valid:
                    continue
                q, cost = valid
                identity = key(q)
                if identity in seen:
                    continue
                seen.add(identity)
                previous = model["last_action"]
                if previous and previous["terms"] == q and evidence <= previous["evidence"] and previous["conditions"] == key(model["conditions"]):
                    continue
                features = self._features(t, model, q, evidence)
                features["previous_cash"] = self._cash(model, model["last_quote"])[0] if model["last_quote"] else 1.0
                features.update(C=cost, rank_C=self._rank_cost(t, q, cost), identity=identity)
                group.append(features)
            if group:
                groups.append(sorted(group, key=lambda a: a["rank_C"]))
        actions, seen = [], set()
        # Round-robin avoids spending the entire action budget on one cheap structure.
        for index in range(max((len(g) for g in groups), default=0)):
            for group in groups:
                if index < len(group) and group[index]["identity"] not in seen:
                    action = group[index]
                    seen.add(action["identity"])
                    action["probabilities"] = self._probabilities(model, action)
                    actions.append(action)
                if len(actions) >= 128 or time.perf_counter() >= cutoff - 0.12:
                    return actions
        return actions

    def _numeric_values(self, source):
        values = set()
        if isinstance(source, Mapping):
            for value in source.values():
                values.update(self._numeric_values(value))
        elif isinstance(source, (list, tuple)):
            for value in source:
                values.update(self._numeric_values(value))
        elif isinstance(source, (int, float)) and not isinstance(source, bool) and math.isfinite(source):
            values.add(Decimal(str(source)).normalize())
        return values

    def _atoms(self, t):
        atoms = []
        try:
            facts = self.facts_for(t)
        except Exception:
            self.note("bayes_fact_error", supplier=t.sid, traceback=traceback.format_exc())
            return atoms
        for refs, sentence in facts:
            ids = list(refs) if isinstance(refs, (tuple, list)) else [refs]
            if not ids or len(set(ids)) > 3 or not all(isinstance(r, str) and r for r in ids):
                continue
            if not isinstance(sentence, str) or not sentence:
                continue
            sources, own, eligible = [], False, True
            for ref in ids:
                try:
                    source = self.claim_source(ref)
                except Exception:
                    self.note("bayes_provenance_error", supplier=t.sid, ref=ref, traceback=traceback.format_exc())
                    source = None
                # Unknown case-only and legacy SQL facts are not automatically authorized.
                if not isinstance(source, Mapping) or not source or source.get("authorized") is False:
                    eligible = False
                    break
                supplier = source.get("supplier_id") or source.get("supplier")
                if supplier is not None and supplier != t.sid:
                    eligible = False
                    break
                own |= supplier == t.sid
                sources.append(source)
            if not eligible:
                continue
            clean = sentence
            for ref in ids:
                clean = clean.replace(ref, "")
            numbers = re.findall(r"(?<![\w.])[-+]?\d[\d,]*(?:\.\d+)?", clean)
            supported = set().union(*(self._numeric_values(s) for s in sources))
            try:
                if any(Decimal(n.replace(",", "")).normalize() not in supported for n in numbers):
                    continue
            except InvalidOperation:
                continue
            issue = next((tag for tag, pattern in (("quality", r"ppm|quality|scorecard"), ("volume", r"volume|forecast"),
                                                    ("payment", r"payment|cash"), ("price", r"cost|price|index|notice"))
                          if re.search(pattern, sentence, re.I)), "terms")
            atoms.append({"refs": list(dict.fromkeys(ids)), "text": sentence, "own": own, "issue": issue})
        return atoms

    def _evidence(self, t, atoms):
        with self._cv:
            available = [a for a in atoms if not any(r in self._spent for r in a["refs"]) and len(self._spent | set(a["refs"])) <= 3]
            states = list(self._states.values())
            generic_owner = max(states, key=lambda s: (s["opportunity"], -s["clock"] if s["known"] else -math.inf))
            available = [a for a in available if a["own"] or generic_owner["sid"] == t.sid]
        if not available:
            return None, 0.0
        relevant = "quality" if any(c["field"] == "ppm_commitment" for c in self._models[t.sid]["conditions"]) else "price"
        atom = max(available, key=lambda a: (a["own"], a["issue"] == relevant))
        return atom, 1.0 if atom["issue"] == relevant else 0.35

    def _baselines(self, sid):
        with self._cv:
            portfolio = self._portfolio
            own = [row[1] for row in portfolio if row[0] == sid and row[3] == 0]
            rivals = [row[1] for row in portfolio if row[0] != sid and row[3] == 0]
            observed = list(self._observed_costs)
        executable = own + rivals
        if math.isfinite(self.c_alt):
            executable.append(self.c_alt)
            rivals.append(self.c_alt)
        observed.extend(executable)
        largest = max(observed, default=0.0)
        spread = max(observed, default=0.0) - min(observed, default=0.0)
        scale = max(1.0, spread, 0.05 * abs(largest))
        surrogate = largest + scale
        B = min(executable, default=surrogate)
        F = min(rivals, default=surrogate)
        return B, F, scale, {"B_surrogate": not bool(executable), "F_surrogate": not bool(rivals),
                             "valid_outside": math.isfinite(self.c_alt), "planning_loss": surrogate}

    def _followup(self, t, model, action, shortlist, weights, F, cutoff, permitted):
        particles = model["particles"]
        values = []
        for p in particles:
            preference = sum(w * x for w, x in zip(p["w"], action["phi"]))
            share = {"responsive": 0.30, "price-rigid/terms-flexible": 0.65, "commitment-seeking": 0.45, "near-final": 0.10}[p["style"]]
            reservation = p["r"] - preference + 0.02
            values.append(reservation + share * max(0, action["previous_cash"] - reservation))
        base = action["terms"]
        o = model["opening"]
        cash0 = self._cash(model, {**base, "unit_price": o})[0]
        cash1 = self._cash(model, {**base, "unit_price": 2 * o})[0]
        slope = (cash1 - cash0) / o
        if slope <= 1e-12:
            return F
        branches = []
        for probability in (0.2, 0.5, 0.8):
            if time.perf_counter() >= cutoff:
                raise ComputeCap
            representative = self._quantile(values, weights, probability)
            price = o + (representative - cash0) / slope
            valid = self._terms(t, {**base, "unit_price": price}, budget=False)
            if not valid:
                branches.append(F)
                continue
            q, cost = valid
            quote = self._features(t, model, q)
            logs = [math.log(max(w * ps[1], 1e-300)) + self._quote_log(model, action, quote, p)
                    for w, ps, p in zip(weights, action["probabilities"], particles)]
            maximum = max(logs)
            updated = [math.exp(v - maximum) for v in logs]
            z = sum(updated)
            if not math.isfinite(z) or z <= 0:
                raise ComputeCap
            updated = [w / z for w in updated]
            close_cost = min(F, cost) if cost <= self.c_alt else F
            best = close_cost
            if permitted:
                for follow in shortlist:
                    if self._canonical(t, follow["terms"]) == self._canonical(t, q) and follow["terms"]["unit_price"] > q["unit_price"]:
                        continue
                    pa = sum(w * ps[0] for w, ps in zip(updated, follow["probabilities"]))
                    pw = sum(w * ps[2] for w, ps in zip(updated, follow["probabilities"]))
                    best = min(best, pa * follow["rank_C"] + pw * F + max(0, 1 - pa - pw) * close_cost)
            branches.append(best)
        return sum(branches) / len(branches)

    def _choose(self, t, model, evidence):
        started = time.perf_counter()
        cutoff = started + 0.85
        B, F, scale, assumptions = self._baselines(t.sid)
        actions = self._actions(t, model, evidence, cutoff)
        weights = self._weights(model)
        with self._cv:
            state = self._states[t.sid]
            slots = self._limit - state["used"] - 3
            near_close = time.time() >= self.deadline - 160 or state["known"] and state["clock"] - time.time() < 25
        cheap = sorted(actions, key=lambda a: a["rank_C"])
        likely = sorted(actions, key=lambda a: -sum(w * ps[0] for w, ps in zip(weights, a["probabilities"])))
        shortlist, seen = [], set()
        for a in cheap[:4] + likely[:4]:
            if a["identity"] not in seen:
                shortlist.append(a)
                seen.add(a["identity"])
        best, best_score = None, 0.0
        ess = 1 / sum(w * w for w in weights)
        for action in cheap:
            if time.perf_counter() >= cutoff:
                break
            predicted = [sum(w * ps[i] for w, ps in zip(weights, action["probabilities"])) for i in range(3)]
            pa, pc, pw = predicted
            try:
                after = self._followup(t, model, action, shortlist, weights, F, cutoff, slots >= 2 and not near_close)
            except ComputeCap:
                break
            information = max(0.0, entropy(predicted) - sum(w * entropy(ps) for w, ps in zip(weights, action["probabilities"])))
            bonus = 0.05 * scale * min(1.0, information) if slots >= 2 and not near_close else 0.0
            savings = pa * (B - action["rank_C"])
            continuation = pc * (B - after)
            walk_loss = pw * (F - B)
            uncertainty = 0.01 * scale / math.sqrt(max(1.0, ess))
            value = savings + continuation - walk_loss + bonus - uncertainty
            if value > best_score:
                best_score = value
                best = {**action, "predicted": predicted, "value": value, "expected_savings": savings,
                        "continuation_value": continuation, "information_bonus": bonus, "walk_loss": walk_loss}
        self.note("bayes_decision", supplier=t.sid, **self._diagnostics(model), evidence_features=evidence,
                  predicted_accept=best["predicted"][0] if best else None,
                  predicted_walk=best["predicted"][2] if best else None,
                  expected_savings=best["expected_savings"] if best else 0.0,
                  continuation_value=best["continuation_value"] if best else 0.0,
                  information_bonus=best["information_bonus"] if best else 0.0,
                  risk_adjusted_value=best_score, chosen_package=best["terms"] if best else None,
                  C=best["C"] if best else None, B=B, F=F, fallback_assumptions=assumptions,
                  catalogue_size=len(actions), compute_seconds=time.perf_counter() - started,
                  stop_reason=None if best else "no_fully_evaluated_positive_incremental_action")
        return best

    def resync(self, t, refresh_clock=True):
        if not hasattr(self, "_cv"):
            return super().resync(t, refresh_clock=refresh_clock)
        started = time.time()
        try:
            response = self.c.thread(self.sid, t.sid)
            messages = response.get("messages")
            if not isinstance(messages, (list, tuple)) or not messages:
                raise ValueError("authoritative thread has no ordered messages")
            if len(messages) < len(t.events):
                raise ValueError("authoritative history would roll the thread backwards")
            old = t._key(t.last)
            t.events = thaw(messages)
            new = t._key(t.last)
            if new != old:
                t.event_revision += 1
                t.event_key = new
                t.pending_request = None
                with self._cv:
                    state = self._states[t.sid]
                    state["pending"] = False
                    state["known"] = False
                    self._clock_request = True
                    self._cv.notify_all()
            t.closed = bool(response.get("closed"))
            t.state_uncertain = False
            self._docs(t.events, t)
            with self._cv:
                state = self._states[t.sid]
                state["read_at"] = started
                state["used"] = max(state["used"], sum(m.get("from") == "buyer" for m in messages))
            self.note("bayes_resync", supplier=t.sid, status=t.status, revision=t.event_revision,
                      closed=t.closed, duration=time.time() - started)
            if self._closing_sid == t.sid:
                if not self._retry_allowed:
                    raise RuntimeError("accept retry already consumed")
                valid = self._terms(t, t.sheets[0].get("terms") or {}) if t.sheets and not t.closed and t.status not in ENDED else None
                identity = t.sheets[0].get("term_sheet_id") if valid else None
                with self._cv:
                    state = self._states[t.sid]
                    if not valid or not identity or (t.sid, identity) in self._accepted or state["used"] >= self._limit:
                        raise RuntimeError("unsafe or duplicate acceptance retry")
                    if time.time() >= self.deadline - 5 or state["known"] and state["clock"] - time.time() <= 5:
                        raise RuntimeError("acceptance retry has insufficient time")
                    state["used"] += 1
                    self._accepted.add((t.sid, identity))
                    self._retry_allowed = False
                self.note("bayes_accept_retry", supplier=t.sid, offer_id=identity, C=valid[1], terms=valid[0])
            return True
        except Exception:
            t.state_uncertain = True
            self.note("bayes_resync_error", supplier=t.sid, traceback=traceback.format_exc())
            if self._closing_sid == t.sid:
                raise
            return False

    def _read_session(self):
        started = time.time()
        return started, self.c.session(self.sid)

    def _consume_session(self, started, session):
        if not isinstance(session, Mapping):
            raise ValueError("invalid session response")
        with self._cv:
            if started < self._session_started:
                return
            self._session_started = started
            if session.get("status") == "ended" and isinstance(session.get("result"), Mapping):
                self._confirmed = thaw(session["result"])
                self.terminal_response = {"status": "ended", "result": self._confirmed}
                self._stop = True
                self._cv.notify_all()
                return
            seconds = session.get("seconds_left")
            threads = session.get("threads")
            clocks = {}
            for sid, state in self._states.items():
                remaining = seconds.get(sid) if isinstance(seconds, Mapping) else seconds
                if isinstance(remaining, Mapping):
                    remaining = remaining.get("seconds_left")
                if remaining is None and isinstance(threads, Mapping) and isinstance(threads.get(sid), Mapping):
                    remaining = threads[sid].get("seconds_left")
                if isinstance(remaining, (int, float)) and not isinstance(remaining, bool) and math.isfinite(remaining):
                    # The read start, not response completion, is the conservative origin.
                    state["clock"] = started + max(0.0, remaining)
                    state["known"] = True
                    state["clock_read"] = started
                    clocks[sid] = max(0.0, state["clock"] - time.time())
            self._clock_request = False
            self._cv.notify_all()
        self.note("bayes_session_clock", read_started=started, clocks=clocks,
                  unknown=[sid for sid in self._states if sid not in clocks])

    def _publish(self, t):
        sheets, costs = [], []
        if not t.closed and not t.state_uncertain and t.status not in ENDED:
            for index, sheet in enumerate(t.sheets):
                valid = self._terms(t, sheet.get("terms") or {})
                identity = sheet.get("term_sheet_id")
                if valid and identity:
                    sheets.append({"index": index, "sheet": thaw(sheet), "terms": valid[0], "C": valid[1]})
                    costs.append(valid[1])
        snapshot = {"status": t.status, "revision": t.event_revision, "closed": t.closed, "sheets": sheets}
        with self._cv:
            if self._confirmed is not None:
                return
            state = self._states[t.sid]
            state["snapshot"] = snapshot
            state["status"] = t.status
            self._observed_costs.extend(costs)
            self._observed_costs = self._observed_costs[-256:]
            self._rebuild_portfolio()
            self._cv.notify_all()
        self.note("bayes_snapshot", supplier=t.sid, **snapshot)

    def _rebuild_portfolio(self):
        # Published tuples own recursively copied sheets; no Thread or lock is copied.
        self._portfolio = tuple((sid, item["C"], thaw(item["sheet"]), item["index"])
                                for sid, state in self._states.items()
                                if not state["in_flight"] and not state["pending"]
                                for item in state["snapshot"]["sheets"])

    def _admit(self, t, mirror=False):
        with self._cv:
            state = self._states[t.sid]
            reserve = 2 if mirror else 3
            allowed = not self._stop and not self._accept_uncertain and self._closing_owner in (None, t.sid)
            allowed &= not state["pending"] and state["used"] < self._limit - reserve
            allowed &= time.time() < self.deadline - 160
            if state["known"]:
                allowed &= state["clock"] - time.time() > 6
            else:
                # Unknown clocks permit only a cheap action after an authoritative read.
                allowed &= time.time() - state["read_at"] < 2
                self._clock_request = True
            return bool(allowed)

    def _reserve_send(self, t, atom, mirror=False):
        with self._cv:
            if not self._admit(t, mirror):
                return False
            refs = set(atom["refs"]) if atom else set()
            if refs & self._spent or len(self._spent | refs) > 3:
                return False
            self._reserved.update(refs)
            self._spent.update(refs)
            state = self._states[t.sid]
            state["used"] += 1
            state["in_flight"] = True
            state["known"] = False
            state["first"] = True
            self._clock_request = True
            self._rebuild_portfolio()
            self._cv.notify_all()
        self.note("bayes_dispatch_reserved", supplier=t.sid, refs=sorted(refs), mirror=mirror,
                  outbound_slots=state["used"], in_flight=True)
        return True

    def _message(self, q, atom=None, mirror=False):
        body = "Thank you. Please confirm this exact package" if mirror else "Thank you. Please consider this joint price-and-terms package"
        body += ": " + fmt(q) + "."
        if atom:
            body += "\n\n" + atom["text"] + "."
        if not mirror:
            body += "\n\nIf a specified term prevents agreement, please identify that term with your counteroffer."
        return {"subject": self.case["title"], "body": "\n".join(["Hello,", "", body] + SIGN),
                "refs": list(atom["refs"]) if atom else [], "term_sheets": [{"terms": thaw(q)}]}

    def _after_dispatch(self, t, ambiguous):
        with self._cv:
            state = self._states[t.sid]
            state["in_flight"] = False
            state["pending"] = ambiguous
            self._clock_request = True
            self._rebuild_portfolio()
            self._cv.notify_all()

    def _confirm(self):
        started, session = self._read_session()
        self._consume_session(started, session)
        return self._confirmed

    def _close_owned(self, t, nomination):
        self._confirm()
        if self._confirmed is not None:
            return
        if not self.resync(t):
            return
        self._publish(t)
        selected = nomination["sheet"]
        if nomination["index"]:
            match = next((s for s in t.sheets[1:] if s.get("term_sheet_id") == selected.get("term_sheet_id")), None)
            valid = self._terms(t, match.get("terms") or {}) if match else None
            identity = selected.get("term_sheet_id")
            if not valid or (t.sid, identity) in self._mirrored or not self._reserve_send(t, None, mirror=True):
                return
            self._mirrored.add((t.sid, identity))
            before = t._key(t.last)
            failed = False
            started = time.time()
            try:
                reply = self.send(t, self._message(valid[0], mirror=True))
                failed = reply is None
            except Exception:
                failed = True
                self.note("bayes_mirror_error", supplier=t.sid, traceback=traceback.format_exc())
            finally:
                self._after_dispatch(t, failed)
            self._confirm()
            if self._confirmed is not None:
                return
            if not self.resync(t):
                return
            primary = self._terms(t, t.sheets[0].get("terms") or {}) if t.sheets else None
            exact = primary and primary[0] == valid[0] and t._key(t.last) != before
            self.note("bayes_mirror_outcome", supplier=t.sid, exact=bool(exact),
                      requested=valid[0], primary=primary[0] if primary else None, duration=time.time() - started)
            self._publish(t)
            if not exact:
                return
        elif not t.sheets or t.sheets[0].get("term_sheet_id") != selected.get("term_sheet_id"):
            self.note("bayes_close_revision_changed", supplier=t.sid, nominated=selected.get("term_sheet_id"),
                      current=t.sheets[0].get("term_sheet_id") if t.sheets else None)
            return
        if t.closed or t.status in ENDED or not t.sheets:
            return
        primary = t.sheets[0]
        valid = self._terms(t, primary.get("terms") or {})
        identity = primary.get("term_sheet_id")
        if not valid or not identity:
            return
        with self._cv:
            state = self._states[t.sid]
            if self._confirmed is not None or (t.sid, identity) in self._accepted or self._limit - state["used"] < 2:
                return
            if time.time() >= self.deadline - 5 or state["known"] and state["clock"] - time.time() <= 5:
                return
            state["used"] += 1
            state["in_flight"] = True
            self._accepted.add((t.sid, identity))
            self._closing_sid = t.sid
            self._retry_allowed = True
            self._accept_uncertain = True
        self.note("bayes_accept", supplier=t.sid, offer_id=identity, terms=valid[0], C=valid[1],
                  retry_capacity_reserved=True, clock_known=state["known"])
        error = None
        try:
            self._close_return = self.close(t, primary)
        except Exception as exc:
            error = exc
            self.note("bayes_close_error", supplier=t.sid, traceback=traceback.format_exc())
        finally:
            self._closing_sid = None
            self._after_dispatch(t, False)
        try:
            confirmed = self._confirm()
        except Exception:
            self.note("bayes_accept_reconcile_error", supplier=t.sid, traceback=traceback.format_exc())
            return
        if confirmed is None:
            # An active session is not proof that an ambiguous accept failed.
            nonambiguous = error is not None and isinstance(getattr(error, "status", None), int) and error.status < 500 and error.status not in (408, 429)
            with self._cv:
                if nonambiguous:
                    self._accept_uncertain = False
            self.note("bayes_accept_unconfirmed", supplier=t.sid, nonambiguous_failure=nonambiguous)

    def _walk_owned(self, t):
        with self._cv:
            if any(s["in_flight"] or s["pending"] for s in self._states.values()):
                return
            safe = [row[1] for row in self._portfolio if row[3] == 0]
            if safe and (not math.isfinite(self.c_alt) or min(safe) < self.c_alt):
                return
            self._accept_uncertain = True
        self.note("bayes_walk", valid_outside=math.isfinite(self.c_alt), executable_safe_costs=safe)
        try:
            self._close_return = self.walk()
        except Exception:
            self.note("bayes_walk_error", supplier=t.sid, traceback=traceback.format_exc())
        self._confirm()

    def _worker(self, t):
        model, atoms = None, []
        next_read = 0.0
        while True:
            try:
                with self._cv:
                    state = self._states[t.sid]
                    if self._stop:
                        return
                    command = state["command"]
                    state["command"] = None
                if command:
                    try:
                        if command["type"] == "close":
                            self._close_owned(t, command)
                        else:
                            self._walk_owned(t)
                    finally:
                        with self._cv:
                            if not self._accept_uncertain:
                                self._closing_owner = None
                                state["stopped"] = False
                            self._cv.notify_all()
                    continue
                if model is None:
                    model = self._new_model(t)
                    self._models[t.sid] = model
                    atoms = self._atoms(t)
                if time.time() >= next_read:
                    ok = self.resync(t)
                    next_read = time.time() + 1.5
                    if not ok:
                        with self._cv:
                            state["stopped"] = True
                        with self._cv:
                            self._cv.wait(0.4)
                        continue
                    self._observe(t, model)
                    self._publish(t)
                with self._cv:
                    paused = state["stopped"] or self._closing_owner is not None or self._accept_uncertain or state["pending"]
                if paused:
                    with self._cv:
                        self._cv.wait(0.35)
                    continue
                if t.closed or t.status in ENDED or t.status in ("agreed", "final_offer"):
                    with self._cv:
                        state["stopped"] = True
                        self._cv.notify_all()
                    self.note("bayes_stop", supplier=t.sid, reason="terminal_or_close_only_status", status=t.status)
                    continue
                if not self._admit(t):
                    with self._cv:
                        state["stopped"] = True
                        self._cv.notify_all()
                    self.note("bayes_stop", supplier=t.sid, reason="time_or_reserved_round_boundary")
                    continue
                atom, evidence = self._evidence(t, atoms)
                action = self._choose(t, model, evidence)
                if action is None:
                    with self._cv:
                        state["stopped"] = True
                        self._cv.notify_all()
                    continue
                valid = self._terms(t, action["terms"], proposing=True)
                if not valid or valid[0] != action["terms"]:
                    self.note("bayes_guard_rejection", supplier=t.sid, reason="final_package_changed_or_invalid")
                    continue
                if not self._reserve_send(t, atom):
                    # A lost evidence race requires a fresh decision, not a weaker argument.
                    self.note("bayes_recompile", supplier=t.sid, reason="claim_or_slot_reservation_changed")
                    with self._cv:
                        self._cv.wait(0.2)
                    continue
                action["conditions"] = key(model["conditions"])
                model["last_action"] = action
                model["pending"] = action
                message = self._message(action["terms"], atom)
                before = t._key(t.last)
                failed = False
                started = time.time()
                self.note("bayes_send", supplier=t.sid, message=message, C=action["C"], evidence_features=evidence)
                try:
                    response = self.send(t, message)
                    failed = response is None
                except Exception:
                    failed = True
                    self.note("bayes_send_error", supplier=t.sid, traceback=traceback.format_exc())
                finally:
                    self._after_dispatch(t, failed)
                self.note("bayes_send_duration", supplier=t.sid, duration=time.time() - started, ambiguous=failed)
                # GET order resolves timeout-generated and opaque offer IDs after every send.
                if self.resync(t):
                    if t._key(t.last) != before:
                        with self._cv:
                            state["pending"] = False
                            self._cv.notify_all()
                    self._observe(t, model)
                    self._publish(t)
                next_read = time.time() + 1.5
            except Exception:
                self.note("bayes_worker_exception", supplier=t.sid, traceback=traceback.format_exc())
                with self._cv:
                    state = self._states[t.sid]
                    state["in_flight"] = False
                    state["stopped"] = True
                    self._cv.notify_all()
                    self._cv.wait(0.5)

    def run(self):
        self._cv = threading.Condition(threading.RLock())
        self._states, self._models = {}, {}
        self._spent, self._reserved, self._accepted, self._mirrored = set(), set(), set(), set()
        self._observed_costs, self._portfolio = [], ()
        self._confirmed = self._close_return = None
        self._closing_owner = self._closing_sid = None
        self._retry_allowed = self._accept_uncertain = self._stop = False
        self._clock_request, self._session_started = True, -math.inf
        self._limit = int(self.case.get("round_limit", 10))
        alternative = self.alt.get("terms") if isinstance(self.alt, Mapping) else None
        valid_alt = self._terms(None, alternative, budget=False) if alternative else None
        self.c_alt = valid_alt[1] if valid_alt else math.inf
        self.note("bayes_outside", valid=bool(valid_alt), C=self.c_alt,
                  reason=None if valid_alt else "absent_or_noncompliant_or_invalid_outside_terms")
        for t in self.threads.values():
            opening = thaw(t.opening_terms)
            price = opening.get("unit_price") or 0.0
            floor = t.est.get("floor") or price
            opportunity = max(0.0, price - floor) / price if price > 0 else 0.0
            self._states[t.sid] = {"sid": t.sid, "used": sum(m.get("from") == "buyer" for m in t.events),
                                   "in_flight": False, "pending": False, "first": False, "stopped": False,
                                   "command": None, "known": False, "clock": self._born + 60,
                                   "clock_read": -math.inf, "read_at": -math.inf, "opportunity": opportunity,
                                   "status": t.status, "snapshot": {"status": t.status, "revision": t.event_revision,
                                                                       "closed": t.closed, "sheets": []}}
            for sheet in t.sheets:
                observed = self._terms(t, sheet.get("terms") or {}, budget=False)
                if observed:
                    self._observed_costs.append(observed[1])
        self.note("bayes_protocol", strategy="bayes_offer", particles=N, experimental_seed=SEED,
                  round_limit=self._limit, accounting="all outbound attempts; two accepts plus final negotiation slot reserved",
                  supplier_wait_reserve=120, closing_planning_reserve=30, safety_margin=10,
                  transport_timeout=getattr(self.c, "timeout", None),
                  transport_guarantee="existing SDK bounds only; blocking requests cannot be cancelled or assumed delivered",
                  compute_cap=0.85, llm_usage=0)
        pool = ThreadPoolExecutor(max_workers=max(1, len(self.threads)), thread_name_prefix="bayes-supplier")
        reads = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bayes-session")
        futures = {t.sid: pool.submit(self._worker, t) for t in self.threads.values()}
        observed_futures = set()
        read_future, next_poll = None, 0.0
        try:
            while time.time() < self.deadline:
                now = time.time()
                if read_future is not None and read_future.done():
                    try:
                        self._consume_session(*read_future.result())
                    except Exception:
                        self.note("bayes_supervisor_read_error", traceback=traceback.format_exc())
                    read_future = None
                    next_poll = time.time() + 1.0
                with self._cv:
                    if self._confirmed is not None:
                        self.note("bayes_terminal_confirmed", result=self._confirmed)
                        return self._close_return if self._close_return == self._confirmed else self._confirmed
                    request_clock = self._clock_request
                if read_future is None and (now >= next_poll or request_clock):
                    read_future = reads.submit(self._read_session)
                for sid, future in futures.items():
                    if future.done() and sid not in observed_futures:
                        observed_futures.add(sid)
                        try:
                            future.result()
                            self.note("bayes_worker_completion", supplier=sid)
                        except Exception:
                            self.note("bayes_worker_failure", supplier=sid, traceback=traceback.format_exc())
                            with self._cv:
                                self._states[sid]["stopped"] = True
                with self._cv:
                    self._rebuild_portfolio()
                    if self._closing_owner is None and not self._accept_uncertain:
                        live = [s for s in self._states.values() if s["status"] not in ENDED]
                        opportunity_given = all(s["first"] or s["stopped"] or s["known"] and s["clock"] - now <= 8 for s in live)
                        nominated = any(s["stopped"] for s in self._states.values())
                        urgent = now >= self.deadline - 160 or any(s["known"] and s["snapshot"]["sheets"] and s["clock"] - now < 25 for s in live)
                        candidates = []
                        for sid, cost, sheet, index in self._portfolio:
                            state = self._states[sid]
                            identity = sheet.get("term_sheet_id")
                            if index == 0 and (sid, identity) in self._accepted:
                                continue
                            if self._limit - state["used"] < (3 if index else 2):
                                continue
                            if index and (now >= self.deadline - 160 or (sid, identity) in self._mirrored):
                                continue
                            if state["known"] and state["clock"] - now <= 5:
                                continue
                            candidates.append((cost, index, sid, sheet))
                        if candidates and (urgent or nominated and opportunity_given):
                            cost, index, sid, sheet = min(candidates, key=lambda row: (row[0], row[1]))
                            self._closing_owner = sid
                            self._states[sid]["command"] = {"type": "close", "sheet": thaw(sheet), "index": index}
                            self.note("bayes_close_election", supplier=sid, C=cost, alternative_mirror=bool(index),
                                      urgent=urgent, first_opportunities=opportunity_given)
                            self._cv.notify_all()
                        elif not candidates and opportunity_given and all(s["stopped"] for s in self._states.values()):
                            idle = [s for s in self._states.values() if not s["in_flight"] and not s["pending"]]
                            executable = any(row[3] == 0 for row in self._portfolio)
                            if idle and len(idle) == len(self._states) and not executable:
                                owner = idle[0]["sid"]
                                self._closing_owner = owner
                                self._states[owner]["command"] = {"type": "walk"}
                                self._cv.notify_all()
                    self._cv.wait(0.25)
            self.note("bayes_stop", reason="wave_deadline", confirmed=self._confirmed is not None,
                      in_flight=[sid for sid, s in self._states.items() if s["in_flight"]],
                      acceptance_uncertain=self._accept_uncertain)
            return self._confirmed
        finally:
            with self._cv:
                self._stop = True
                self._cv.notify_all()
            # A slow supplier must not extend the caller's wave after confirmed closure.
            pool.shutdown(wait=False, cancel_futures=True)
            reads.shutdown(wait=False, cancel_futures=True)
