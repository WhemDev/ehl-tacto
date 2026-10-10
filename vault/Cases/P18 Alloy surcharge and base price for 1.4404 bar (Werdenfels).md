---
case_id: "case:P18"
set: "practice"
type: "raw_material"
goal: "leverage"
hosted: true
suppliers: ["sup:70740"]
tags: ["case", "raw_material"]
---
# case:P18 · Alloy surcharge and base price for 1.4404 bar (Werdenfels)

raw_material · goal **leverage** · suppliers sup:70740 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Blankstahl Werdenfels GmbH. Alloy surcharge and base price for 1.4404 bar (Werdenfels). Need: 23700 kg a year. Category goal: leverage: competition and data should bring the price down. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 14 days). Fallback if you walk away: the second-source quote quote:7200018. Must-haves: none. Prepare from the data package.

## Must-haves
_none_

## Alternative
```json
{
 "kind": "quote",
 "ref": "quote:7200018",
 "terms": {
  "unit_price": 6.31,
  "payment_days": 30,
  "lead_time_days": 10,
  "volume_per_year": 23700,
  "contract_months": 24,
  "effective_date": "2027-01-01",
  "index_clause": null,
  "incoterm": "DAP",
  "tooling_eur": 0,
  "ppm_commitment": 75
 }
}
```

## Terms
- negotiable: unit_price, index_clause, payment_days, contract_months
- fixed: `{"lead_time_days": 14, "volume_per_year": 23700, "effective_date": "2027-01-01", "incoterm": "DAP", "tooling_eur": 0}`
- options: `{"index_clause": [null, {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 0, "base_month": "2026-08"}, {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 3, "base_month": "2026-08"}, {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}], "payment_days": [14, 30, 45, 60, 90], "contract_months": [12, 24, 36]}`

## Buyer rates
```json
{
 "need_per_year": 23700,
 "horizon_years": 2,
 "current_unit_price": 5.84,
 "fallback_unit_price": 6.13,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 14,
 "category_goal": "leverage",
 "fallback_risk_pct": 3,
 "index_risk_pct": 1,
 "late_cost_per_day": 96,
 "cost_per_defect": 0,
 "freight_eur_per_unit": {
  "EXW": 0.06,
  "FCA": 0.05,
  "DAP": 0.0
 },
 "index_paths": {
  "AS-14404": 0.06
 }
}
```

## Refs
`doc:20260922-70740-P18`, `ctr:4600070740`, `sc:70740@2026Q3`, `quote:7200018` · trigger `doc:20260922-70740-P18`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P18" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
