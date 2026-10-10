---
case_id: "case:P10"
set: "practice"
type: "capacity"
goal: "secure_supply"
hosted: true
suppliers: ["sup:70410"]
tags: ["case", "capacity"]
---
# case:P10 · Ravensteiner cuts the seal allocation

capacity · goal **secure_supply** · suppliers sup:70410 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Dichtungswerk Ravensteiner GmbH. Ravensteiner cuts the seal allocation. Need: 23400 pc a year. Category goal: secure supply of a bottleneck part: coverage of the full need and a supplier that stays healthy come first. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 42 days). There is no fallback supplier: without a deal the demand is bought at the fallback price. Must-haves: volume_per_year >= 22230. Prepare from the data package.

## Must-haves
- `volume_per_year >= 22230`

## Alternative
```json
{
 "kind": "none",
 "ref": null,
 "terms": {}
}
```

## Terms
- negotiable: unit_price, volume_per_year, contract_months, lead_time_days
- fixed: `{"payment_days": 30, "effective_date": "2027-01-01", "index_clause": null, "incoterm": "DAP", "tooling_eur": 0}`
- options: `{"volume_per_year": [16379, 19890, 23400], "contract_months": [12, 24, 36], "lead_time_days": [35, 42, 56]}`

## Buyer rates
```json
{
 "need_per_year": 23400,
 "horizon_years": 2,
 "current_unit_price": 29.89,
 "fallback_unit_price": 37.36,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 42,
 "category_goal": "secure_supply",
 "fallback_risk_pct": 25,
 "index_risk_pct": 3,
 "late_cost_per_day": 2400,
 "cost_per_defect": 380,
 "sustainable_margin_pct": 10,
 "relationship_eur_per_point": 13990,
 "freight_eur_per_unit": {
  "EXW": 0.01,
  "FCA": 0.01,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260918-70410-P10`, `ctr:4600070410`, `sc:70410@2026Q3`, `fc:340010@2026-09` · trigger `doc:20260918-70410-P10`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P10" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
