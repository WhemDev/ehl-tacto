---
case_id: "case:P07"
set: "practice"
type: "bundling"
goal: "routine"
hosted: true
suppliers: ["sup:70610"]
tags: ["case", "bundling"]
---
# case:P07 · Bundle the fastener kit with one distributor

bundling · goal **routine** · suppliers sup:70610 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Schraubenhandel Leitner & Sohn GmbH. Bundle the fastener kit with one distributor. Need: 30000 kits a year. Category goal: routine: fewer suppliers and less process cost. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 5 days). Fallback if you walk away: today's terms continue unchanged. Must-haves: none. Prepare from the data package.

## Must-haves
_none_

## Alternative
```json
{
 "kind": "current_contract",
 "ref": null,
 "terms": {
  "unit_price": 6.29,
  "payment_days": 30,
  "lead_time_days": 5,
  "volume_per_year": 30000,
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
- fixed: `{"lead_time_days": 5, "volume_per_year": 30000, "effective_date": "2027-01-01", "index_clause": null, "incoterm": "DAP", "tooling_eur": 0}`
- options: `{"payment_days": [14, 30, 45, 60, 90], "contract_months": [12, 24, 36]}`

## Buyer rates
```json
{
 "need_per_year": 30000,
 "horizon_years": 2,
 "current_unit_price": 6.29,
 "fallback_unit_price": 6.91,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 5,
 "category_goal": "routine",
 "fallback_risk_pct": 5,
 "index_risk_pct": 2,
 "late_cost_per_day": 40,
 "cost_per_defect": 6,
 "freight_eur_per_unit": {
  "EXW": 0.08,
  "FCA": 0.07,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260909-70610-P07`, `ctr:4600070610`, `sc:70610@2026Q3` · trigger `doc:20260909-70610-P07`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P07" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
