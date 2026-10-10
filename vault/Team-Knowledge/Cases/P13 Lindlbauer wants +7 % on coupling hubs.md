---
case_id: "case:P13"
set: "practice"
type: "price_increase"
goal: "leverage"
hosted: false
suppliers: ["sup:70230"]
tags: ["case", "price_increase"]
---
# case:P13 · Lindlbauer wants +7 % on coupling hubs

price_increase · goal **leverage** · suppliers sup:70230 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Präzisionsteile Lindlbauer KG. Lindlbauer wants +7 % on coupling hubs. Need: 17900 pc a year. Category goal: leverage: competition and data should bring the price down. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 28 days). Fallback if you walk away: the second-source quote quote:7200013. Must-haves: none. Prepare from the data package.

## Must-haves
_none_

## Alternative
```json
{
 "kind": "quote",
 "ref": "quote:7200013",
 "terms": {
  "unit_price": 17.87,
  "payment_days": 30,
  "lead_time_days": 42,
  "volume_per_year": 17900,
  "contract_months": 12,
  "effective_date": "2027-01-01",
  "index_clause": null,
  "incoterm": "EXW",
  "tooling_eur": 800,
  "ppm_commitment": 318
 }
}
```

## Terms
- negotiable: unit_price, payment_days, effective_date
- fixed: `{"lead_time_days": 28, "volume_per_year": 17900, "contract_months": 12, "index_clause": null, "incoterm": "EXW", "tooling_eur": 0}`
- options: `{"payment_days": [14, 30, 45, 60, 90], "effective_date": ["2026-11-01", "2027-01-01", "2027-04-01"]}`

## Buyer rates
```json
{
 "need_per_year": 17900,
 "horizon_years": 1.0,
 "current_unit_price": 16.3,
 "fallback_unit_price": 17.6,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 28,
 "category_goal": "leverage",
 "fallback_risk_pct": 3,
 "index_risk_pct": 1,
 "late_cost_per_day": 160,
 "cost_per_defect": 72,
 "freight_eur_per_unit": {
  "EXW": 0.1,
  "FCA": 0.09,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260927-70230-P13`, `ctr:4600070230`, `sc:70230@2026Q3`, `quote:7200013` · trigger `doc:20260927-70230-P13`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P13" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
