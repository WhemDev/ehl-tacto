---
case_id: "case:D02"
set: "demo"
type: "rfq"
goal: "leverage"
suppliers: ["sup:DEMO-J1", "sup:DEMO-C1"]
tags: ["case", "rfq"]
---
# case:D02 · New stainless pump shaft SH-220: award one of two suppliers

rfq · goal **leverage** · suppliers sup:DEMO-J1, sup:DEMO-C1 · round limit 10

## Briefing
The new PX pump series needs shaft SH-220 (1.4021). Two suppliers quote: a German job shop and a Polish machining company. Lead time must not exceed 42 days; the line needs parts within 35 days, every day later costs EUR 150. Machined shafts are a leverage category: several capable suppliers, the goal is the lowest total cost. Award one.

## Must-haves
- `lead_time_days <= 42`

## Alternative
```json
{
 "kind": "quote",
 "ref": "quote:D02-ALT",
 "terms": {
  "unit_price": 19.9,
  "incoterm": "DAP",
  "payment_days": 60,
  "lead_time_days": 35
 }
}
```

## Terms
- negotiable: unit_price, payment_days, lead_time_days, incoterm
- fixed: `{"contract_months": 24}`
- options: `{"payment_days": [14, 30, 45, 60], "lead_time_days": [21, 28, 35, 42, 49], "incoterm": ["EXW", "FCA", "DAP"]}`

## Buyer rates
```json
{
 "category_goal": "leverage",
 "need_per_year": 6000,
 "horizon_years": 2,
 "current_unit_price": null,
 "fallback_unit_price": 19.9,
 "fallback_risk_pct": 5,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 35,
 "late_cost_per_day": 150,
 "cost_per_defect": 40,
 "freight_eur_per_unit": {
  "EXW": 0.6,
  "FCA": 0.4,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`quote:D02-ALT`, `sc:DEMO-J1@2026Q3`, `sc:DEMO-C1@2026Q3`, `cost:part:SH-220`, `fc:SH-220@2026-09`, `news:N-0412` · trigger `None`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:D02" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
