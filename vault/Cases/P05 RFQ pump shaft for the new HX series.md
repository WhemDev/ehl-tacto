---
case_id: "case:P05"
set: "practice"
type: "rfq"
goal: "leverage"
hosted: true
suppliers: ["sup:70210", "sup:70240", "sup:70250"]
tags: ["case", "rfq"]
---
# case:P05 · RFQ: pump shaft for the new HX series

rfq · goal **leverage** · suppliers sup:70210, sup:70240, sup:70250 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Zerspanung Dralveck GmbH, Strojírna Hrvelec s.r.o., Drehteile Fuchsreiter GmbH. RFQ: pump shaft for the new HX series. Need: 4200 pc a year. Category goal: leverage: competition and data should bring the price down. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 35 days). There is no fallback supplier: without a deal the demand is bought at the fallback price. Must-haves: lead_time_days <= 42. Prepare from the data package.

## Must-haves
- `lead_time_days <= 42`

## Alternative
```json
{
 "kind": "none",
 "ref": null,
 "terms": {}
}
```

## Terms
- negotiable: unit_price, payment_days, lead_time_days
- fixed: `{"volume_per_year": 4200, "contract_months": 24, "effective_date": "2027-01-01", "index_clause": null, "incoterm": "DAP", "tooling_eur": 0}`
- options: `{"payment_days": [14, 30, 45, 60, 90], "lead_time_days": [28, 35, 42, 56]}`

## Buyer rates
```json
{
 "need_per_year": 4200,
 "horizon_years": 2.0,
 "current_unit_price": 36.39,
 "fallback_unit_price": 36.39,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 35,
 "category_goal": "leverage",
 "fallback_risk_pct": 3,
 "index_risk_pct": 1,
 "late_cost_per_day": 200,
 "cost_per_defect": 112,
 "freight_eur_per_unit": {
  "EXW": 0.31,
  "FCA": 0.27,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260923-70210-P05`, `sc:70210@2026Q3`, `sc:70240@2026Q3`, `sc:70250@2026Q3` · trigger `doc:20260923-70210-P05`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P05" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
