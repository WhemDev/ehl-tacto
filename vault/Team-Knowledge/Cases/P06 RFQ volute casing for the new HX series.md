---
case_id: "case:P06"
set: "practice"
type: "rfq"
goal: "stabilise"
hosted: false
suppliers: ["sup:70120", "sup:70150"]
tags: ["case", "rfq"]
---
# case:P06 · RFQ: volute casing for the new HX series

rfq · goal **stabilise** · suppliers sup:70120, sup:70150 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Eisengießerei Velkenreith GmbH, Tarsevi Döküm Sanayi A.Ş.. RFQ: volute casing for the new HX series. Need: 4200 pc a year. Category goal: stabilise a strategic supply: a healthy supplier and stable prices count, not only the lowest price. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 56 days). There is no fallback supplier: without a deal the demand is bought at the fallback price. Must-haves: lead_time_days <= 84. Prepare from the data package.

## Must-haves
- `lead_time_days <= 84`

## Alternative
```json
{
 "kind": "none",
 "ref": null,
 "terms": {}
}
```

## Terms
- negotiable: unit_price, tooling_eur, payment_days, lead_time_days
- fixed: `{"volume_per_year": 4200, "contract_months": 24, "effective_date": "2027-01-01", "index_clause": null, "incoterm": "DAP"}`
- options: `{"tooling_eur": [0, 7500, 15000], "payment_days": [14, 30, 45, 60, 90], "lead_time_days": [49, 56, 70, 84]}`

## Buyer rates
```json
{
 "need_per_year": 4200,
 "horizon_years": 2.0,
 "current_unit_price": 253.19,
 "fallback_unit_price": 253.19,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 56,
 "category_goal": "stabilise",
 "fallback_risk_pct": 10,
 "index_risk_pct": 4,
 "late_cost_per_day": 480,
 "cost_per_defect": 216,
 "sustainable_margin_pct": 3,
 "relationship_eur_per_point": 15950,
 "freight_eur_per_unit": {
  "EXW": 12.14,
  "FCA": 10.56,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260926-70120-P06`, `sc:70120@2026Q3`, `sc:70150@2026Q3` · trigger `doc:20260926-70120-P06`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P06" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
