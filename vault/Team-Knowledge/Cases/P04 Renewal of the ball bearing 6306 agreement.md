---
case_id: "case:P04"
set: "practice"
type: "renewal"
goal: "routine"
hosted: true
suppliers: ["sup:70620"]
tags: ["case", "renewal"]
---
# case:P04 · Renewal of the ball bearing 6306 agreement

renewal · goal **routine** · suppliers sup:70620 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Wälzlager-Zentrum Süd GmbH. Renewal of the ball bearing 6306 agreement. Need: 20000 pc a year. Category goal: routine: fewer suppliers and less process cost. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 7 days). Fallback if you walk away: the second-source quote quote:7200004. Must-haves: none. Prepare from the data package.

## Must-haves
_none_

## Alternative
```json
{
 "kind": "quote",
 "ref": "quote:7200004",
 "terms": {
  "unit_price": 5.04,
  "payment_days": 30,
  "lead_time_days": 10,
  "volume_per_year": 20000,
  "contract_months": 24,
  "effective_date": "2027-01-01",
  "index_clause": null,
  "incoterm": "DAP",
  "tooling_eur": 0,
  "ppm_commitment": 0
 }
}
```

## Terms
- negotiable: unit_price, payment_days, contract_months
- fixed: `{"lead_time_days": 7, "volume_per_year": 20000, "effective_date": "2027-01-01", "index_clause": null, "incoterm": "DAP", "tooling_eur": 0}`
- options: `{"payment_days": [14, 30, 45, 60, 90], "contract_months": [12, 24, 36]}`

## Buyer rates
```json
{
 "need_per_year": 20000,
 "horizon_years": 2,
 "current_unit_price": 4.39,
 "fallback_unit_price": 4.7,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 7,
 "category_goal": "routine",
 "fallback_risk_pct": 5,
 "index_risk_pct": 2,
 "late_cost_per_day": 75,
 "cost_per_defect": 95,
 "freight_eur_per_unit": {
  "EXW": 0.02,
  "FCA": 0.02,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260920-70620-P04`, `ctr:4600070620`, `sc:70620@2026Q3`, `quote:7200004`, `fc:360020@2026-09` · trigger `doc:20260920-70620-P04`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P04" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
