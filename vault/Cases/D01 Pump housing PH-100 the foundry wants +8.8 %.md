---
case_id: "case:D01"
set: "demo"
type: "price_increase"
goal: "stabilise"
suppliers: ["sup:DEMO-F1"]
tags: ["case", "price_increase"]
---
# case:D01 · Pump housing PH-100: the foundry wants +8.8 %

price_increase · goal **stabilise** · suppliers sup:DEMO-F1 · round limit 10

## Briefing
Demo Gießerei GmbH, our single source for the grey-iron pump housing PH-100 for 12 years, announces +8.8 % from 1 December citing energy and wages. Castings are a strategic category: the goal is to stabilise supply with a healthy partner, so squeezing the foundry below a 4 % margin costs us (from EUR 5,000 per margin point and year). We need 4,000 housings a year for the next two years; anything not covered by this deal costs EUR 55.00 per unit (spot buys and a second source). Price, payment terms, contract length and the date the new price applies are open; lead time and Incoterm are fixed.

## Must-haves
_none_

## Alternative
```json
{
 "kind": "none"
}
```

## Terms
- negotiable: unit_price, payment_days, contract_months, effective_date
- fixed: `{"lead_time_days": 35, "incoterm": "FCA"}`
- options: `{"payment_days": [30, 45, 60], "contract_months": [12, 24], "effective_date": ["2026-12-01", "2027-01-01", "2027-02-01", "2027-04-01"]}`

## Buyer rates
```json
{
 "category_goal": "stabilise",
 "need_per_year": 4000,
 "horizon_years": 2,
 "current_unit_price": 48.6,
 "fallback_unit_price": 55.0,
 "fallback_risk_pct": 5,
 "sustainable_margin_pct": 4,
 "relationship_eur_per_point": 5000,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 35,
 "late_cost_per_day": 0,
 "cost_per_defect": 0,
 "freight_eur_per_unit": {
  "EXW": 1.9,
  "FCA": 1.2,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:D01-LETTER`, `ctr:D01-FRAMEWORK`, `sc:DEMO-F1@2026Q2`, `sc:DEMO-F1@2026Q3`, `po:4500001201`, `po:4500001288`, `po:4500001342`, `cost:part:PH-100` · trigger `doc:D01-LETTER`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:D01" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
