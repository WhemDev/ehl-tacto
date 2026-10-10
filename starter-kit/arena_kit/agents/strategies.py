"""Deterministic BOA-style policy variants for repeatable arena experiments.

All three use the published buyer cost and hard must-have checks. C is a small
within-session contextual bandit, not a pretrained or cross-session RL model.
"""

from itertools import product

from ..cost import complete_offer, must_haves_ok, total_cost
from ..docs import standard_terms
from ..play import latest, live_threads, moves_left, standing


def _feasible(case, terms, standard=None):
    try:
        return terms.get("unit_price") is not None and must_haves_ok(case, terms, standard)
    except (KeyError, TypeError, ValueError):
        return False


def _cost(case, terms, events=()):
    try:
        return total_cost(case, terms, standard_terms(events))
    except (KeyError, TypeError, ValueError):
        return float("inf")


def _price_bounds(case, theirs, ours):
    """Buyer-favorable opening anchor and a conservative walk-away price floor."""
    options = case.get("term_options", {}).get("unit_price", [])
    floor = min(options) if options else min(theirs, (case["buyer"].get("current_unit_price") or theirs) * 0.80)
    floor = min(floor, theirs)
    anchor = min(theirs, max(floor, theirs * 0.85))
    if ours is not None:
        anchor = max(floor, min(theirs, ours))
    return round(anchor, 2), round(floor, 2)


def _package(case, terms, target_price):
    """Choose the cheapest legal package at/under a price target by enumerating term options."""
    fields = case.get("negotiable", [])
    options = case.get("term_options", {})
    candidate_values = []
    for field in fields:
        if field == "unit_price":
            vals = {round(target_price, 2)}
            vals.update(v for v in options.get(field, []) if v <= target_price)
        elif field in options and options[field]:
            vals = list(options[field])  # index clauses are dictionaries, not hashable values
        elif terms.get(field) is not None:
            vals = {terms[field]}
        else:
            vals = {None}
        candidate_values.append(sorted(vals, key=str))
    best = None
    for values in product(*candidate_values):
        raw = dict(zip(fields, values, strict=True))
        offer = complete_offer(case, {**terms, **raw, "unit_price": raw.get("unit_price", target_price)})
        if not _feasible(case, offer):
            continue
        cost = total_cost(case, offer)
        if best is None or cost < best[0]:
            best = (cost, offer)
    if best:
        return best[1]
    return complete_offer(case, {**terms, "unit_price": target_price})


def _buyer_emails(case, action, strategy):
    if action.get("type"):
        return action
    return {
        "subject": case["title"],
        "body": strategy,
        "term_sheets": [{"terms": action}],
    }


class ControlledAgent:
    """A: cost/constraint guard, single package and fixed linear concession schedule."""

    def __init__(self, floor_fraction=0.80):
        self.floor_fraction = floor_fraction
        self.initial_cost = {}

    def decide(self, case, threads):
        live = live_threads(threads)
        if not live:
            raise ValueError("No live supplier threads")
        sid = min(live, key=lambda s: _cost(case, standing(threads[s])[1], threads[s]))
        events = threads[sid]
        offer_id, theirs = standing(events)
        if not offer_id or theirs.get("unit_price") is None:
            return {"supplier_id": sid, "message": {"action": {"type": "walk_away"}}}
        current_cost = _cost(case, theirs, events)
        alternative = (case.get("buyer", {}).get("alternative") or {}).get("terms") or {}
        alt_cost = total_cost(case, alternative) if alternative.get("unit_price") else float("inf")
        mine = [m["term_sheets"][0]["terms"] for m in events if m.get("from") == "buyer" and m.get("term_sheets")]
        round_no = len(mine)
        anchor, floor = _price_bounds(case, theirs["unit_price"], mine[-1].get("unit_price") if mine else None)
        floor = max(floor, theirs["unit_price"] * self.floor_fraction)
        target = max(floor, anchor - round_no * (anchor - floor) / max(1, case.get("round_limit", 10) - 1))
        if (
            _feasible(case, theirs, standard_terms(events))
            and current_cost <= min(alt_cost, self.initial_cost.get(sid, current_cost))
            and (
                latest(events).get("status") in {"agreed", "final_offer"}
                or moves_left(case, events) <= 1
                or current_cost <= _cost(case, _package(case, theirs, target), events)
            )
        ):
            return {"supplier_id": sid, "message": {"action": {"type": "accept", "term_sheet_id": offer_id}}}
        self.initial_cost.setdefault(sid, current_cost)
        package = _package(case, theirs, target)
        return {
            "supplier_id": sid,
            "message": _buyer_emails(
                case,
                package,
                "Thank you. We reviewed the complete terms and propose this package so we can reach an agreement.",
            ),
        }


class AdaptiveHybridAgent(ControlledAgent):
    """B: response-aware package search, conditional movement and supplier coordination."""

    def __init__(self, floor_fraction=0.80, response_weight=0.20):
        super().__init__(floor_fraction)
        self.response_weight = response_weight

    def decide(self, case, threads):
        live = live_threads(threads)
        if not live:
            raise ValueError("No live supplier threads")
        # Give uncontacted suppliers an early look; after that, work the best feasible standing offer.
        uncontacted = [s for s in live if not any(m.get("from") == "buyer" for m in threads[s])]
        pool = uncontacted or live
        sid = min(pool, key=lambda s: _cost(case, standing(threads[s])[1], threads[s]))
        events = threads[sid]
        offer_id, theirs = standing(events)
        if not offer_id or theirs.get("unit_price") is None:
            return {"supplier_id": sid, "message": {"action": {"type": "walk_away"}}}
        their_cost = _cost(case, theirs, events)
        mine = [m["term_sheets"][0]["terms"] for m in events if m.get("from") == "buyer" and m.get("term_sheets")]
        anchor, floor = _price_bounds(case, theirs["unit_price"], mine[-1].get("unit_price") if mine else None)
        floor = max(floor, theirs["unit_price"] * self.floor_fraction)
        # Track movement in buyer-cost space. A cooperative response earns a firmer next target.
        previous = self.initial_cost.get(sid, their_cost)
        progress = max(0.0, min(1.0, (previous - their_cost) / max(1.0, previous)))
        round_no = len(mine)
        base_target = anchor - round_no * (anchor - floor) / max(1, case.get("round_limit", 10) - 1)
        # Reward favorable supplier movement with a firmer (lower-cost) target.
        concession = (anchor - floor) * self.response_weight * progress
        target = max(floor, round(base_target - concession, 2))
        target_package = _package(case, theirs, target)
        alt = (case.get("buyer", {}).get("alternative") or {}).get("terms") or {}
        alt_cost = total_cost(case, alt) if alt.get("unit_price") else float("inf")
        if (
            _feasible(case, theirs, standard_terms(events))
            and their_cost <= min(alt_cost, self.initial_cost.get(sid, their_cost))
            and (
                latest(events).get("status") in {"agreed", "final_offer"}
                or moves_left(case, events) <= 1
                or their_cost <= total_cost(case, target_package, standard_terms(events))
            )
        ):
            return {"supplier_id": sid, "message": {"action": {"type": "accept", "term_sheet_id": offer_id}}}
        self.initial_cost.setdefault(sid, their_cost)
        return {
            "supplier_id": sid,
            "message": _buyer_emails(
                case,
                target_package,
                "Please consider this package, which keeps the full requirement covered.",
            ),
        }


class LearningHybridAgent(AdaptiveHybridAgent):
    """C: online contextual bandit over fixed and adaptive target schedules."""

    ARMS = ("controlled", "adaptive")

    def __init__(self, exploration=0.35, **kwargs):
        super().__init__(**kwargs)
        self.exploration = exploration
        self.arm_stats = {}
        self.last_arm = {}
        self.last_cost = {}
        self.arm_counts = {arm: 0 for arm in self.ARMS}
        self.arm_reward = {arm: 0.0 for arm in self.ARMS}

    def decide(self, case, threads):
        # Context is case family + supplier count. Rewards use observed buyer-cost improvement.
        live = live_threads(threads)
        if not live:
            raise ValueError("No live supplier threads")
        sid = min(live, key=lambda s: _cost(case, standing(threads[s])[1], threads[s]))
        ctx = (case.get("type", "unknown"), len(threads))
        events = threads[sid]
        current = _cost(case, standing(events)[1], events)
        last = self.last_cost.get(sid)
        if last is not None and current < float("inf"):
            reward = max(-1.0, min(1.0, (last - current) / max(1.0, abs(last))))
            arm = self.last_arm.get(sid)
            if arm:
                n, total = self.arm_stats.get((ctx, arm), (0, 0.0))
                self.arm_stats[(ctx, arm)] = (n + 1, total + reward)
                self.arm_counts[arm] += 1
                self.arm_reward[arm] += reward
        arms = [self.arm_stats.get((ctx, arm), (0, 0.0)) for arm in self.ARMS]
        total_n = sum(n for n, _ in arms)
        scores = []
        for arm, (n, total) in zip(self.ARMS, arms, strict=True):
            mean = total / n if n else 0.0
            bonus = self.exploration * ((total_n + 1) / (n + 1)) ** 0.5
            scores.append((mean + bonus, arm))
        arm = max(scores)[1]
        self.last_arm[sid], self.last_cost[sid] = arm, current
        if arm == "controlled":
            # Controlled schedule has a fixed, slower target path.
            agent = ControlledAgent(self.floor_fraction)
            agent.initial_cost = dict(self.initial_cost)
            decision = agent.decide(case, threads)
        else:
            decision = super().decide(case, threads)
        return decision

    def diagnostics(self):
        return {
            "arm_counts": self.arm_counts,
            "arm_reward_sum": self.arm_reward,
            "context_observations": {
                f"{context}:{arm}": count for (context, arm), (count, _) in self.arm_stats.items()
            },
        }
