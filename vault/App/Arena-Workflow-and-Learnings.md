# Arena Workflow & Sandbox Learnings

> Written 2026-10-10 after hand-playing both sandbox cases (`case:D01`, `case:D02`). Sandbox sessions do **not** cost practice quota. Practice cases and the hidden final suppliers may behave differently, so treat these as hypotheses to test on `P01…P18`, not facts.

Related: [[Overview]] · [[Architecture]] · [[Tech-Stack]] · [[Resources]]

---

## 1. What the system is

We are Hollerau Pumpenwerke (fictional German pump maker). Each **case** is one negotiation against one to three **supplier bots** (LLM-driven, with hard economic limits). We negotiate **by e-mail + term sheets**, then **accept one standing term sheet** or **walk away**. The score is based on the **total cost C in €** of the accepted deal.

```mermaid
flowchart LR
    A[POST /sessions case_id] --> B[Round 0: every supplier sends quote e-mail + quote PDF]
    B --> C[We send message: body + up to 3 term sheets + refs + attachments]
    C --> D[Supplier reply: body, standing term sheet(s), status, claim_results, signals]
    D -->|status open| C
    D -->|final_offer / agreed| E[accept term_sheet_id]
    C -->|walk_away| F[No deal = score of our alternative, else 0]
    E --> G[Result: c_open, c_deal, c_best, score, cost_breakdown]
```

**Score** = (C_open − C_deal) / (C_open − C_best), clipped 0…1. `C_open` = best opening quote, `C_best` = best package any supplier would ever accept (hidden). No deal scores our alternative (0 if none).

### Message anatomy
| Field | Notes |
|---|---|
| `body` | Plain text. The supplier reads **all** of it: tone, questions, arguments, threats. |
| `term_sheets` | 0-3 alternatives, each with *every* negotiable field. **Only term sheets bind.** Use `complete_offer(case, terms)` to fill/snap to allowed values. |
| `refs` | Data IDs we rely on (`po:…`, `fc:…`). IDs written in the body count too. |
| `attachments` | md/csv/json readable by supplier. |
| `action` | `accept` (needs `term_sheet_id`) or `walk_away`. |

### Supplier reply anatomy
`status`: `open` · `final_offer` (push again and it may walk) · `agreed` (matches our terms; **we still must accept**) · `walked_away` · `no_bid`.
`claim_results` per cited ID: `verified` · `contradicted` (wrong figure/unknown ID: costs trust) · `irrelevant` · `duplicate`.
`missing_fields`: anything left out **closes on the supplier's standard terms** (listed in the quote PDF).

### Limits
60 s per message (from the supplier's reply), round limit 10 messages per thread (`round_limit`), 3 late messages in a row end a thread. Practice quota 200/24h per team (shared!). Sandbox is free.

---

## 2. How the cost C works (what we are actually optimising)

Price × committed units is only one part. From the cases we played (see `cost_breakdown` in each result):

| Component | What it means in practice |
|---|---|
| Price | unit price × units; units bought **before** the new price's `effective_date` are at the old price. |
| Uncovered need | A **12-month** contract only covers half of a 2-year need; the rest is priced at the fallback price + risk. → **24 months is hugely valuable**. |
| Payment terms | Interest (8%) for paying **earlier than the 60-day reference**. Paying earlier costs us only a bit, but suppliers credit it generously (see below). |
| Freight | By Incoterm (EXW 0.6, FCA 0.4, DAP 0 per unit in D02): **DAP is not free to the supplier**, it prices it in. |
| Lead time | € per day beyond the need (D02: 35 d need, €150/day), and a **hard must-have** (≤ 42 d). |
| Quality | Expected defects from the supplier's committed PPM × cost per defect. Read it from the **quote PDF**. |
| Supplier health | Strategic cases (D01): € per margin point the supplier is left below a sustainable margin: don't squeeze to the floor. |

**Always read the quote PDF** (`/doc` in `chat.py`, or `read_document`). Its "standard terms" block is what you get for anything unstated.

---

## 3. Results

| Run | Case | Approach | C_deal | Score |
|---|---|---|---|---|
| Naive agent (`arena play`) | D01 | 1% steps, accepts round 4 | €440,757 | **0.20** |
| Hand run 1 | D01 | 24 mo + volume + cited POs → pushed too hard → `final_offer` | €416,605 | **0.80** |
| Hand run 2 | D01 | 24 mo + cited POs + start later + 30d pay; "sign today" | €414,994 | **0.84** |
| Hand run 1 | D02 | Parallel threads, DAP/35d/30d, accepted Polish supplier | €201,776 | **0.22** |
| Hand run 2 | D02 | Flexible on lead time (42 d), EXW, 14-day payment, cited `fc:`/`cost:`/`sc:` | €195,467 | **0.33** |

(D01 `C_open` 448,811, `C_best` 408,624. D02 `C_open` 214,296, `C_best` 156,739.)

---

## 4. D01: Foundry wants +8.8 % (single supplier, `stabilise`)

Supplier: family-run foundry owner. Opens €52.90 / 30 d / 12 mo / from 2026-12-01. Our current price €48.60. Fallback for uncovered need €55.

### What worked
- **Offer a 24-month contract.** Biggest single move: C fell from ~€449k to ~€422k before any real price haggling. A 12-month deal leaves half the need uncovered at the €55 fallback.
- **Confirm the volume and cite real data.** The supplier repeatedly asks "binding volume forecast… send the data". Citing our own order IDs (`po:4500001201`, `po:4500001288`, `po:4500001342`, from the case `refs`) came back `verified` and the price fell €51.40 → €50.80.
- **Offer 3 alternative term sheets in the first message.** The supplier answers with 1-2 counter sheets and reveals which levers it moves on.
- **Trade, don't just ask lower.** Later start date (phase-in) bought a lower price at about €0.30 per extra ~2 months; the supplier valued 30-day payment too.
- **"We can sign today" + a small ask.** Asking 50.20 on the supplier's own proposed package brought 50.50; repeating exactly 50.50 flipped status to `agreed`.
- **Ask what matters to them.** A question with no term sheet got: "contract length and price are most important, reliable payment also helps". It even dropped €52.90 → €52.70 as "goodwill" for pure engagement.

### What didn't work
- **Generic arguments with no data ID** ("WAGES-METAL is only +3.1%"). No claim was even parsed, and the supplier replied with `final_offer` and hardened. Don't argue from unverifiable statements.
- **Pushing 2 rounds in a row too aggressively** → `final_offer` at 50.80. Moderation in run 2 got to 50.50 without a final-offer lock.
- **The naive agent's habit** of splitting the difference and accepting early left most of the gain.
- Walking away scores **0** (no alternative in D01).

---

## 5. D02: Stainless shaft SH-220, RFQ with two suppliers (`leverage`, award one)

Suppliers: **DEMO-J1** (German job shop, owner "needs work and cash"): opens €17.10 / 30 d / 28 d lead / EXW std. PPM 1100. **DEMO-C1** (Polish machining, "growing supplier, eager"): opens €16.00 / 45 d / EXW, **omits lead time**, standard lead time **45 d**, PPM 2600. Constraints: lead ≤ 42 d (must-have), need 35 d, €150/day beyond need, defect €40.

### What worked
- **Parallel threads.** Both suppliers move toward us when they feel competition. We ran both and compared C at every step.
- **Spot the trap in the cheapest quote.** C1's €16.00 looked best but silently closes on a 45 d lead time → must-have violated → score 0. Always compare using each quote's *standard terms*.
- **Loosen what is cheap for us, tighten what is expensive.** Biggest unlock: asking for **lead time 42 d (our limit), EXW pick-up, 14-day payment** took both from ~€16.6-16.7 to **€15.60**. Lead 35→42 d costs us ~€1k total (7 days × €150), while the supplier rewards it heavily (J1: "14 days payment helps us a lot right now, I can give you a much better price").
- **Early payment is under-priced by us, over-credited by suppliers.** 15 days earlier bought ~€0.20/unit from C1 vs ~€0.04 interest cost to us. Check each supplier's exchange rate.
- **Supplier-specific hooks.** J1 (job shop) responded to cash and "work", C1 to payment and growth. Reading the persona mattered.
- **Cost breakdown from J1** (it said it had no "fancy" one, but attached an xlsx): material 5.56 + wages 4.39 + conversion 2.81 + **overhead & profit 2.84** (~18%). That shows how much room exists above the true cost floor.
- **Citing case refs.** `fc:SH-220@2026-09` (volume) → `verified` by J1 → €15.60 → €15.40. `cost:part:SH-220` (should-cost) and `sc:DEMO-C1@2026Q3` (scorecard) → `verified` by C1 → €15.60 → €15.50. `news:N-0412` → `irrelevant` to C1.
- **Competition disclosure.** We told each supplier truthfully the other's price/terms; both asked for "proof" and the attached `.md` summary was accepted without fuss.

### What didn't work
- **Insisting on DAP + 35 d.** Pushes the supplier's price up (C1: 16.00 → 16.90 once we required DAP/35 d/60 d), and J1 simply answered with FCA.
- **A tough price ask with "level on price" framing** (14.40 vs 15.60) → both held firm. The gains came from new information and trades, not from bare pressure.
- **Same fact twice** → `duplicate` (C1 on `fc:`), no extra credit. Each verified fact moves the price once.
- **Both suppliers declared `final_offer`** after we asked for large cuts + citations at once; after that, further asks risk a walk-away.
- **Remaining gap.** Even our best deal (€15.40) left us at score 0.33; `C_best` is ~€156.7k, i.e. ≈ €13.06/unit. We did not find the lever that gets there. Untested ideas: a much higher binding volume, `news:N-0412` on J1 (it may concern J1's material), 21 d overtime lead time, 49-day lead time rules, asking J1 for DAP at the EXW price, using one supplier's `final_offer` as a hard counter on the other, and splitting asks across more rounds (we used about 5 of 10).

---

## 6. General playbook (draft, to validate on practice cases)

1. **Prepare:** read case file (`/case`), quote PDF(s), `refs`; compute C for each standing term sheet and the opening quotes *with standard terms*.
2. **Message 1:** one polite e-mail with 2-3 alternative term sheets that vary *different* levers (contract length, payment, start date, lead time, Incoterm). Cite verifiable IDs from `refs`. Don't reveal urgency, budget or a missing alternative.
3. **Read the reply:** what did the supplier move on? What did it ask for (volume data, proof of competitor)? Check `claim_results`.
4. **Trade the cheap-for-us levers**; hold what is expensive for us. Recompute C each round.
5. **Move gradually**; avoid back-to-back large asks that trigger `final_offer`.
6. **Use `agreed`/`final_offer`:** on `agreed`, still send `accept`. On `final_offer`, compare against the other thread / our alternative and decide.
7. **Never accept a quote with missing fields without checking its standard terms.**
8. **Keep an eye on the clock** (60 s) and on rounds left.

---

## 7. Setup notes / gotchas

- Code lives **outside the vault**: `~/Documents/EHL-Hackathon-code/starter-kit` (a clone of `tacto-ai/negotiation-arena-kit`). Put the key in `starter-kit/.env` only (it's gitignored). **Never** paste the key into the vault or chat logs; one key per team.
- `uv sync --all-extras` needs network access to GitHub (it downloads Python 3.12).
- **macOS gotcha:** after `uv sync`, `uv run arena …` may fail with `ModuleNotFoundError: No module named 'arena_kit'`. The editable-install `.pth` file gets the macOS *hidden* flag and Python ignores it. Fix: `chflags nohidden .venv/lib/python3.12/site-packages/*.pth`.
- `uv run arena play case:D01 -v` runs the **naive bot** automatically (no chat, ~1 second). To negotiate yourself: `uv run python chat.py case:D01` (interactive script in `starter-kit/chat.py`).
- Sandbox: `case:D01` (1 supplier), `case:D02` (RFQ, 2 suppliers). Sandbox facts like `po:4500001201`, `fc:SH-220@2026-09` are **not** in the downloadable data package; they only exist inside the arena (cited via the case `refs`).
- `uv run arena data` downloads the data package (24 tables, `world.sqlite`) for practice cases; the Sunday release is public from 2026-10-11 06:00 UTC.

## 8. Open questions for the team

- Which lever gets D02 closer to `C_best` (≈ €13/unit)?
- How different are the hosted practice suppliers (P01-P18) from the demo suppliers?
- Should the real agent be (a) LLM writing e-mails with code-computed C and term-sheet search, or (b) a mostly rule-based negotiator with an LLM only for wording? See [[Architecture]].
