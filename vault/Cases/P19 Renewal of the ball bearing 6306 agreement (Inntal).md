---
case_id: "case:P19"
set: "practice"
type: "renewal"
goal: "routine"
hosted: false
suppliers: ["sup:70640"]
tags: ["case", "renewal"]
---
# case:P19 · Renewal of the ball bearing 6306 agreement (Inntal)

renewal · goal **routine** · suppliers sup:70640 · round limit 10

## Briefing
You negotiate for Hollerau Pumpenwerke with Kugellager-Vertrieb Inntal GmbH. Renewal of the ball bearing 6306 agreement (Inntal). Need: 8580 pc a year. Category goal: routine: fewer suppliers and less process cost. Score: the lowest total cost C as defined in the rules, valued with this case's rates (need lead time 10 days). Fallback if you walk away: the second-source quote quote:7200019. Must-haves: none. Prepare from the data package.

## Must-haves
_none_

## Alternative
```json
{
 "kind": "quote",
 "ref": "quote:7200019",
 "terms": {
  "unit_price": 4.63,
  "payment_days": 30,
  "lead_time_days": 7,
  "volume_per_year": 8580,
  "contract_months": 24,
  "effective_date": "2027-01-01",
  "index_clause": null,
  "incoterm": "DAP",
  "tooling_eur": 0,
  "ppm_commitment": 302
 }
}
```

## Terms
- negotiable: unit_price, payment_days, contract_months
- fixed: `{"lead_time_days": 10, "volume_per_year": 8580, "effective_date": "2027-01-01", "index_clause": null, "incoterm": "DAP", "tooling_eur": 0}`
- options: `{"payment_days": [14, 30, 45, 60, 90], "contract_months": [12, 24, 36]}`

## Buyer rates
```json
{
 "need_per_year": 8580,
 "horizon_years": 2,
 "current_unit_price": 4.2,
 "fallback_unit_price": 4.49,
 "interest_rate": 0.08,
 "reference_payment_days": 60,
 "need_lead_time_days": 10,
 "category_goal": "routine",
 "fallback_risk_pct": 5,
 "index_risk_pct": 2,
 "late_cost_per_day": 75,
 "cost_per_defect": 95,
 "freight_eur_per_unit": {
  "EXW": 0.03,
  "FCA": 0.03,
  "DAP": 0.0
 },
 "index_paths": {}
}
```

## Refs
`doc:20260925-70640-P19`, `ctr:4600070640`, `sc:70640@2026Q3`, `quote:7200019`, `fc:360020@2026-09` · trigger `doc:20260925-70640-P19`

## Runs
```dataview
TABLE score, deal, supplier, rounds, agent, commit
FROM "Runs" WHERE case = "case:P19" SORT score DESC
```

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
