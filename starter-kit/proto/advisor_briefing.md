# Briefing: an AI buyer agent for the Tacto Negotiation Arena — please help us raise our score

You are an expert in automated negotiation, procurement and game-theoretic bargaining agents. We are a hackathon team (EHL Grand Finale 2026, Tacto track). Read the whole briefing, then give us **concrete, implementable optimisation tricks** to raise our score. We have about 14 hours until code freeze. Everything must be **generic**: the final uses ~50 hidden cases with suppliers and case/supplier-type combinations we have never seen, so no rule may be tied to a specific case, supplier or price.

## 1. The challenge

We are the procurement team of a fictional German pump maker. Each **case** is one negotiation: a trigger (price-increase letter, expiring contract, RFQ…), a case file (need per year, horizon in years, current price, fallback price, category goal, negotiable fields with allowed options, fixed terms, must-haves, our alternative) and 1–3 **supplier bots**. The bots are LLM-driven by the organiser, with hidden economics: a cost floor, an approval ladder, a persona (family foundry, cash-short job shop, group with approval ladder, near-monopolist…), and "they give nothing without a move from you".

**Protocol:** round 0: every supplier sends a quote e-mail + quote PDF (its standard terms apply to every field a sheet leaves out). Then we send e-mails: a plain-text body, up to **3 term sheets** (each must set every negotiable field to an allowed option), `refs` (data IDs we rely on; at most 3 claims are checked per message) and optional md/csv/json attachments. The supplier answers with a body, a standing term sheet (+ sometimes an alternative sheet), a status (`open`, `final_offer` — push further and it may walk, `agreed` — it offers exactly our terms, we must still accept, `walked_away`, `no_bid`), signals, missing fields and **claim results** per cited fact: `verified`, `contradicted` (wrong figure / unknown ID — costs trust), `irrelevant`, `duplicate` (each ID counts once per case). Only the supplier's **first (primary) sheet** can be accepted; an alternative has to be sent back as our terms first (it then says `agreed`). Round limit 10 messages per thread. **60 seconds per message, per thread**, counted from the supplier's reply; idle time counts as timeouts, 3 in a row end the thread. Supplier replies take 1–120 s under load.

**Score per case:** `score = clip((C_open − C_deal) / (C_open − C_best), 0, 1)`. C is the **total cost** of covering our fixed need over the horizon, computed by a published formula: price × committed units (units before a later effective date at the old price) + uncovered need × fallback price × (1 + fallback risk) + interest for paying earlier than a reference (8 %/yr) + freight by Incoterm + € per day of lead time beyond our need + expected defects × (cost per defect − chargeback) + tooling + index clause (expected move on the index path beyond the deadband × material share, plus an index-risk %) + for `stabilise`/`secure_supply` goals a **relationship charge** for every margin point the deal leaves the supplier below a sustainable margin. C_open = best opening quote; C_best = the best package any supplier would ever accept, all levers applied (hidden, fixed per case). No deal = our alternative's score (0 if none). A broken must-have = 0.

**Final:** 5 waves × 8 minutes, up to 10 cases in parallel per key, no human in the loop. Score per wave = mean case score × 100. Practice: 10 hosted practice cases (200 sessions/24 h for the team, ~120 left) + 2 free sandbox cases with 3 demo suppliers. A data package exists (SQLite: orders, invoices, scorecards, contracts with notice periods, should-cost estimates, cost drivers per part with index weights, monthly index series, forecasts, negotiation history per supplier/part, news, letters, quotes) with `facts.json` listing every citable ID and the values the arena checks.

## 2. Our agent (deterministic engine, no LLM in the loop)

Code picks every number, templates write the e-mail. Main parts:

1. **Target C (our own C_best estimate):** for every allowed lever combination, solve the price where the supplier's *cash value* (a kit function: price adjusted for payment timing at the supplier's cost of money, freight leg, units at the old price, chargebacks) equals its estimated **cost floor**, cost that package with the published C, take the minimum. Floor sources in order: the supplier's own cost-breakdown attachment (material + labour + conversion), a rival's material €/unit ÷ this supplier's stated material share, should-cost (capped so the opening keeps a sustainable margin), current price ÷ (1 + margin) × cost-driver drift, or 85 % of the lowest opening. Supplier cost of money from its credit index.
2. **Concession:** goal C(round) = start + (best standing offer C − start)·(round/T)^(1/e); start = target × (1 + anchor). Current: e = 2 (concede early, visibly), T = 4, anchor −3 % (RFQ: −8 %). Room priors make the first ask at least 15 % (leverage) / 8 % (routine, quality) below the opening. Bottleneck (`secure_supply`): first ask ≥ opening price × 0.90 with full coverage.
3. **Packages (MESO):** each message carries 2 term sheets (RFQ: 1) that cost us the same C (tolerance tied to the case's room) but differ in levers (payment days, contract months, start date, Incoterm, lead time, ppm/chargeback, index clause); ranked by the supplier's estimated cash value with a ×3 aversion to chargebacks; never priced above the supplier's own price; full-coverage packages first; lead time never beyond our need.
4. **Terms the supplier insists on:** if it insists on a term in the same sentence that names it, or adds a structured clause on its own, every package carries that term in the variant cheapest for us (index clause: same series, widest deadband in the options); never a variant that cuts coverage or a must-have; echoes of our own proposals don't count.
5. **Evidence:** one or two new verified facts per message (each fact moves a supplier at most once): notice period (letter vs contract), should-cost, cost drivers that **fell** over a 3/6/12-month window (never a rising one), our order history, weak scorecards, growing forecasts, our alternative quote only if cheaper than the ask, cheaper orders of the same part at another supplier (as a plain sentence), the supplier's own renewal history. Answers to its questions: binding volume with the forecast ID, fixed terms are stated as fixed, an on-time payment promise if it complains about late payment, our data sheet attached when it asks "which figures is that based on", the supplier's own cost breakdown quoted back to it.
6. **RFQ:** one worker per supplier thread on its own 60 s clock; **staggered opening** (cheapest quote first, the others are opened citing its fresh, improved offer ID — verified by the arena); the rival's best standing offer ID is cited to the others; never close while a supplier is untouched; accept agreed/final offers at once (a late accept is recovered by re-reading the thread).
7. **Closing:** accept when the best standing offer reaches our next goal (one extra "hold" round while the supplier still concedes > 0.5 %); after a final offer, push up to 3 × 3 % only if a rival's offer backs us up (never in single-supplier cases: a push made one walk away); recall the supplier's best earlier package if its offers got worse; close before the wave cap with max(90 s, slowest round + 15 s).

## 3. Results

**Sandbox (deterministic-ish demo suppliers):** D01 (single foundry, price increase, stabilise) **0.982**; D02 (RFQ, 2 suppliers, leverage) **0.70–0.79** (C_deal ≈ €172k vs C_best €156.7k; J1 settles at €13.9–14.0/unit, the best package implies ≈ €12.8–13.0).

**Hosted practice, latest run (A9):**

| Case | Type · goal | Score | Notes |
|---|---|---|---|
| P01 | price increase · stabilise | 0.956 | above the board record |
| P02 | price increase (copper) · stabilise | 0.360 | room open→best only 2.1 %; a previous run got 0.68 when the supplier agreed to a copper-clause package |
| P03 | renewal · stabilise | 0.923 | supplier "froze all price reductions, talk about terms" |
| P04 | renewal · routine | 0.810 | room 1.2 %; final at round 2 |
| P05 | RFQ, 3 suppliers · leverage | 0.665 | all three converge at €29.5–30; C_best ≈ €26.3; record 0.82 |
| P07 | bundling · routine | 0.710 | final €5.43 vs C_best ≈ €4.99; supplier keeps asking for "more volume" (volume fixed); record 0.78 |
| P08 | raw material (stainless bar, AS-14404 index) · leverage | 0.586 | index clause demanded for >12 months; final €5.40 + clause; record 0.65, house agent 0.75 |
| P10 | capacity (seal allocation cut) · secure supply | 0.671 | went final in round 1; took its 54-day alternative (late cost €28.8k) |
| P11 | quality · quality first | 0.710 | final €45.50, 300 ppm, no chargeback; payment and Incoterm fixed; record 0.79 |
| P18 | raw material · leverage | 0.485 | clause demanded; it said "we can agree to your proposed price of €5.30 … must maintain the index clause"; record 0.67 |
| **Mean** | | **0.688** | best per case over all our runs 0.717; board #3 at ~70 |

## 4. Observations about the supplier bots

- The deal lands near our **first ask**; suppliers make one big step in round 1, then small steps, and go final after 2–4 of our messages.
- "No move from you, no move from us": an unchanged ask stalls them; a new verified fact usually buys one step; a repeated fact is `duplicate`.
- Verified ≠ convincing: "it holds, but it does not change our calculation"; "that is not our reality: our AS-14404 is covered at fixed prices until March 2027".
- They answer questions honestly-ish ("material accounts for about 45 % of our cost"), sometimes attach cost breakdowns, ask for proof of volume/rival offers, and react to tone (on-time payment promise landed).
- Raw-material suppliers insist on an index clause for > 12 months and price the deadband cheaply (+€0.05–0.12).
- Bottleneck suppliers go final immediately if anchored far below their opening.
- Under load, replies take up to ~2 minutes; the 60 s per-thread clock is the main operational risk.

## 5. Constraints for your suggestions

- **Generic only** (triggers on case features, case type/goal, data, or what the supplier writes) — the final has unseen suppliers and combinations.
- Deterministic code preferred; an LLM may write or read text but must not invent numbers or IDs; < 10 s per turn.
- Practice quota is scarce (~120 sessions for 4 people); the sandbox is free but has only 3 demo suppliers.
- Rules: no prompt injection against the bots, no reading live leaderboards during the final.

## 6. What we ask you

1. The **10 most valuable, generic optimisation tricks** to raise the expected final score, ranked by expected points, each with: the mechanism (why it should work on these bots), exactly how to implement it in an engine like ours (trigger, parameters, guardrails), the risk, and how to test it cheaply.
2. Specifically: how to get closer to C_best in **multi-supplier RFQs** (our D02/P05 plateau at ~0.66–0.79) and in **raw-material cases with mandatory index clauses** (P08/P18).
3. How to make the **first ask** better calibrated (it decides the deal) without insulting bottleneck suppliers — a generic estimator of the supplier's true floor from what we can observe (opening, first counter, stated material share, cost drivers, credit index, persona text).
4. Anything in our approach you think is **wrong or risky** for the hidden final (robustness, timing, edge cases), and what you would change first with 14 hours left.

Please be concrete (formulas, thresholds, pseudo-code) and prioritise by expected score gain per hour of work.
