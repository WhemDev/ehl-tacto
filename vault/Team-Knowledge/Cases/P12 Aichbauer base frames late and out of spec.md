---
case_id: "case:P12"
set: "practice"
type: "quality"
goal: "quality_first"
hosted: false
suppliers: ["sup:70310"]
tags: ["case", "quality"]
---
# case:P12 · Aichbauer: base frames late and out of spec

quality · goal **quality_first** · suppliers sup:70310 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Blechtechnik Aichbauer GmbH. Aichbauer: base frames late and out of spec. Need: 8980 pc a year. Category goal: quality first: defects and late deliveries cost more than a few cents of price. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 23 days). Fallback if you walk away: today's terms continue unchanged. Must-haves: none. Prepare from the data package.

## Must-haves
_none_

## Alternative
```json
{
 "kind": "current_contract",
 "ref": "ctr:4600070310",
 "terms": {
  "unit_price": 100.14,
  "payment_days": 45,
  "lead_time_days": 21,
  "volume_per_year": 8980,
  "contract_months": 12,
  "effective_date": "2027-01-01",
  "index_clause": null,
  "incoterm": "DAP",
  "tooling_eur": 0,
  "ppm_commitment": 4118,
  "chargeback_eur_per_complaint": 150
 }
}
```

## Terms
- negotiable: ppm_commitment, chargeback_eur_per_complaint, unit_price, lead_time_days
- fixed: `{"payment_days": 45, "volume_per_year": 8980, "contract_months": 12, "effective_date": "2027-01-01", "index_clause": null, "incoterm": "DAP", "tooling_eur": 0}`
- options: `{"ppm_commitment": [300, 800, 1500, 2500], "chargeback_eur_per_complaint": [0, 150, 300, 500], "lead_time_days": [16, 21, 23, 35]}`

## Buyer rates
```json
{
 "need_per_year": 8980,
 "horizon_years": 1.0,
 "current_unit_price": 100.14,
 "fallback_unit_price": 106.15,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 23,
 "category_goal": "quality_first",
 "fallback_risk_pct": 8,
 "index_risk_pct": 2,
 "late_cost_per_day": 450,
 "cost_per_defect": 275,
 "freight_eur_per_unit": {
  "EXW": 1.61,
  "FCA": 1.4,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260924-70310-P12`, `ctr:4600070310`, `sc:70310@2026Q3` · trigger `doc:20260924-70310-P12`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P12" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
