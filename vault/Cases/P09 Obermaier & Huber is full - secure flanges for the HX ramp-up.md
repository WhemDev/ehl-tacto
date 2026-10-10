---
case_id: "case:P09"
set: "practice"
type: "capacity"
goal: "secure_supply"
hosted: false
suppliers: ["sup:70220"]
tags: ["case", "capacity"]
---
# case:P09 · Obermaier & Huber is full - secure flanges for the HX ramp-up

capacity · goal **secure_supply** · suppliers sup:70220 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with CNC-Technik Obermaier & Huber GmbH. Obermaier & Huber is full - secure flanges for the HX ramp-up. Need: 15600 pc a year. Category goal: secure supply of a bottleneck part: coverage of the full need and a supplier that stays healthy come first. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 28 days). Fallback if you walk away: the second-source quote quote:7200009. Must-haves: lead_time_days <= 42. Prepare from the data package.

## Must-haves
- `lead_time_days <= 42`

## Alternative
```json
{
 "kind": "quote",
 "ref": "quote:7200009",
 "terms": {
  "unit_price": 16.33,
  "payment_days": 45,
  "lead_time_days": 56,
  "volume_per_year": 15600,
  "contract_months": 12,
  "effective_date": "2027-01-01",
  "index_clause": null,
  "incoterm": "FCA",
  "tooling_eur": 800,
  "ppm_commitment": 980
 }
}
```

## Terms
- negotiable: unit_price, lead_time_days, volume_per_year, payment_days
- fixed: `{"contract_months": 12, "effective_date": "2027-01-01", "index_clause": null, "incoterm": "EXW", "tooling_eur": 0}`
- options: `{"lead_time_days": [21, 28, 35, 42, 49], "volume_per_year": [10920, 13260, 15600], "payment_days": [14, 30, 45, 60, 90]}`

## Buyer rates
```json
{
 "need_per_year": 15600,
 "horizon_years": 1.0,
 "current_unit_price": 16.02,
 "fallback_unit_price": 20.03,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 28,
 "category_goal": "secure_supply",
 "fallback_risk_pct": 25,
 "index_risk_pct": 3,
 "late_cost_per_day": 1800,
 "cost_per_defect": 90,
 "sustainable_margin_pct": 4,
 "relationship_eur_per_point": 5000,
 "freight_eur_per_unit": {
  "EXW": 0.18,
  "FCA": 0.16,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260915-70220-P09`, `ctr:4600070220`, `sc:70220@2026Q3`, `quote:7200009`, `fc:320030@2026-09` · trigger `doc:20260915-70220-P09`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P09" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
