---
case_id: "case:P15"
set: "practice"
type: "bundling"
goal: "routine"
hosted: false
suppliers: ["sup:70430"]
tags: ["case", "bundling"]
---
# case:P15 · Bundle O-rings, gaskets and lip seals

bundling · goal **routine** · suppliers sup:70430 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Elasto-Dicht Hermannsdorfer GmbH. Bundle O-rings, gaskets and lip seals. Need: 25000 kits a year. Category goal: routine: fewer suppliers and less process cost. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 7 days). Fallback if you walk away: today's terms continue unchanged. Must-haves: none. Prepare from the data package.

## Must-haves
_none_

## Alternative
```json
{
 "kind": "current_contract",
 "ref": null,
 "terms": {
  "unit_price": 5.66,
  "payment_days": 30,
  "lead_time_days": 7,
  "volume_per_year": 25000,
  "contract_months": 24,
  "effective_date": "2027-01-01",
  "index_clause": null,
  "incoterm": "DAP",
  "tooling_eur": 0
 }
}
```

## Terms
- negotiable: unit_price, payment_days, contract_months
- fixed: `{"lead_time_days": 7, "volume_per_year": 25000, "effective_date": "2027-01-01", "index_clause": null, "incoterm": "DAP", "tooling_eur": 0}`
- options: `{"payment_days": [14, 30, 45, 60, 90], "contract_months": [12, 24, 36]}`

## Buyer rates
```json
{
 "need_per_year": 25000,
 "horizon_years": 2,
 "current_unit_price": 5.66,
 "fallback_unit_price": 6.23,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 7,
 "category_goal": "routine",
 "fallback_risk_pct": 5,
 "index_risk_pct": 2,
 "late_cost_per_day": 50,
 "cost_per_defect": 25,
 "freight_eur_per_unit": {
  "EXW": 0.01,
  "FCA": 0.01,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260913-70430-P15`, `ctr:4600070430`, `sc:70430@2026Q3` · trigger `doc:20260913-70430-P15`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P15" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
