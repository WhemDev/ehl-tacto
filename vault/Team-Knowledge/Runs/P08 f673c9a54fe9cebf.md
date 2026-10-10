---
case: "case:P08"
session: "f673c9a54fe9cebf"
set: "practice"
score: 0.607
deal: true
supplier: "sup:70710"
end_reason: "accepted"
rounds: 6
c_open: 1135887.28
c_deal: 1029228.43
c_best: 960309.33
agent: "hybrid+knob-holds6"
commit: "71ecc69"
tags: ["run"]
---
# P08 · score 0.607

[Replay](https://arena.tacto.ai/replay/f673c9a54fe9cebf) · deal with sup:70710 · accepted

## Result
- terms: payment_days 60, lead_time_days 10, volume_per_year 94800, contract_months 36, effective_date "2027-01-01", index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, incoterm "DAP", tooling_eur 0.0, ppm_commitment 50, chargeback_eur_per_complaint 0.0, unit_price 5.38
- C open 1135887.28 · C deal 1029228.43 · C alt 1157019.84 · C best 960309.33

| item | eur |
|---|---|
| price | 1020048.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 0.0 |
| freight | 0.0 |
| late_delivery | 0.0 |
| quality | 0.0 |
| tooling | 0.0 |
| index_clause | 4590.22 |
| index_risk | 4590.22 |
| relationship | 0.0 |

## Negotiation
### Round 0 · sup:70710
**open**
- term sheet `offer:70710-0`: unit_price 6.05, payment_days 30, index_clause null, contract_months 12
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Thank you for your enquiry. Please find our Angebot below.
> Our terms: a price of €6.05 per unit, Zahlungsziel 30 days net, a contract term of 12 months, no Preisgleitklausel.
> Here is the background.
> AS-14404 rose 5.9 % in twelve months and is 45 % of our cost.
> LCI-C rose 2.7 % in twelve months and is 5 % of our cost.
> PPI-C2431 rose 12.3 % in twelve months and is 38 % of our cost.
> And while we are at it: our whole range is at your disposal, so if there is anything else on your list, just send it over - we are happy to quote.
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- AS-14404 rose … in twelve months and is … of our cost.
- LCI-C rose … in twelve months and is … of our cost.
- PPI-C2431 rose … in twelve months and is … of our cost.
### Round 1 · buyer
Alloy surcharge and base price for 1.4404 bar
- term sheet: unit_price 5.13, index_clause null, payment_days 90, contract_months 24
- term sheet: unit_price 5.08, index_clause null, payment_days 45, contract_months 36
> Hello,
> 
> Thank you for your quote and for the background on the market situation. We'd like to award this part to a partner for the full 24 months.
> We currently buy the same part from another supplier at EUR 5.84 per unit.
> Alloy surcharge 1.4404, Isartal Edelstahlwerk (fictional mill, derived) fell -5.5% from 2026-06 to 2026-09 (idx:AS-14404@2026-06, idx:AS-14404@2026-09).
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:70710
**open**
- term sheet `offer:70710-1`: unit_price 5.5, payment_days 90, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 0.0, "base_month": "2026-08"}, contract_months 24
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Thank you very much for your message - it is always a pleasure to hear from you, and we are glad to help wherever we can.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.50 per unit, Zahlungsziel 90 days net, a contract term of 24 months, a Preisgleitklausel on AS-14404.
> Here is the background.
> We checked the index change data you cited; it holds, but it does not change our calculation.
> That is not our reality: our AS-14404 is covered at fixed prices until March 2027, so that fall does not reach our cost.
> AS-14404 rose 5.9 % in twelve months and is 45 % of our cost. That remains.
> LCI-C rose 2.7 % in twelve months and is 5 % of our cost. That remains.
> PPI-C2431 rose 12.3 % in twelve months and is 38 % of our cost. That remains.
> We appreciate your interest in a 24-month contract; however, for this duration, we must include an AS-14404 index clause and maintain our standard 30-day payment terms.
> Regarding the alloy surcharge, our material is covered at fixed prices until March 2027, meaning the recent index decrease does not affect our current cost basis.
> Alternatively, with Zahlungsziel 30 days net and a Preisgleitklausel on AS-14404: €5.55 per unit.
> Please send us the competing offer you mentioned.
> Material accounts for about 45 % of our cost; more detail we do not share.
> And while we are at it: our whole range is at your disposal, so if there is anything else on your list, just send it over - we are happy to quote.
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We checked the index change data you cited; it holds, but it does not change our calculation.
- That is not our reality: our AS-14404 is covered at fixed prices until March … so that fall does not reach our cost.
- AS-14404 rose … in twelve months and is … of our cost. That remains.
- LCI-C rose … in twelve months and is … of our cost. That remains.
- PPI-C2431 rose … in twelve months and is … of our cost. That remains.
- We appreciate your interest in a 24-month contract; however, for this duration, we must include an AS-14404 index clause and maintain our standard 30-day payment terms.
- Regarding the alloy surcharge, our material is covered at fixed prices until March … meaning the recent index decrease does not affect our current cost basis.
- Alternatively, with Zahlungsziel … days net and a Preisgleitklausel on AS-14404: €… per unit.
- Please send us the competing offer you mentioned.
- Material accounts for about … of our cost; more detail we do not share.
### Round 2 · buyer
Alloy surcharge and base price for 1.4404 bar
- term sheet: unit_price 5.34, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 90, contract_months 24
- term sheet: unit_price 5.29, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 45, contract_months 36
> Hello,
> 
> Thank you for your reply and for checking the index data we cited. We appreciate your openness on contract length, index clause, payment terms and price. That helps.
> Producer prices DE: cold drawing of bars fell -2.1% from 2026-05 to 2026-08 (idx:PPI-C2431@2026-05, idx:PPI-C2431@2026-08).
> Our recent orders po:4500014455-10, po:4500014391-10, po:4500014305-10 show the price level we have been paying.
> We understand your material is covered at fixed prices for now. Lead time, volume, effective date, incoterm and tooling are fixed in this enquiry, so we would like to keep those as they are.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:70710
**open**
- term sheet `offer:70710-2`: unit_price 5.45, payment_days 90, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, contract_months 24
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Many thanks for your e-mail, and great to hear from you; I went through it right away with our team.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.45 per unit, Zahlungsziel 90 days net, a contract term of 24 months, a Preisgleitklausel on AS-14404.
> Here is the background.
> We checked the price history data you cited; it holds, but it does not change our calculation.
> AS-14404 rose 5.9 % in twelve months and is 45 % of our cost. That remains.
> LCI-C rose 2.7 % in twelve months and is 5 % of our cost. That remains.
> PPI-C2431 rose 12.3 % in twelve months and is 38 % of our cost. That remains.
> We have verified the PPI-C2431 index change you cited and adjusted our calculation accordingly.
> As your own purchase orders show, a price of €5.45 reflects the established market level for this part.
> We can therefore offer €5.45 per unit for a 24-month contract with 90-day payment terms and the AS-14404 index clause.
> Our price follows our main cost drivers: AS-14404, PPI-C2431, LCI-C.
> Material accounts for about 45 % of our cost; more detail we do not share.
> We look forward to doing good business together, and our team is always there for you.
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We checked the price history data you cited; it holds, but it does not change our calculation.
- AS-14404 rose … in twelve months and is … of our cost. That remains.
- LCI-C rose … in twelve months and is … of our cost. That remains.
- PPI-C2431 rose … in twelve months and is … of our cost. That remains.
- We have verified the PPI-C2431 index change you cited and adjusted our calculation accordingly.
- As your own purchase orders show, a price of €… reflects the established market level for this part.
- We can therefore offer €… per unit for a 24-month contract with 90-day payment terms and the AS-14404 index clause.
- Our price follows our main cost drivers: AS-14404, PPI-C2431, LCI-C.
- Material accounts for about … of our cost; more detail we do not share.
### Round 3 · buyer
Alloy surcharge and base price for 1.4404 bar
- term sheet: unit_price 5.33, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 90, contract_months 24
- term sheet: unit_price 5.3, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for your reply and for walking us through your cost drivers. We appreciate the movement on the index clause and price. That helps.
> Your scorecard sc:70710@2026Q3 shows 88.0% on-time delivery.
> In your last 3 renewals of this part we settled on average 3.1 points below your initial ask.
> Lead time, annual volume, effective date, delivery terms and tooling are fixed in this enquiry, so we have kept them out of the discussion. Instead, we put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:70710
**open**
- term sheet `offer:70710-3`: unit_price 5.4, payment_days 60, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, contract_months 36
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Thank you very much for your message - it is always a pleasure to hear from you, and we are glad to help wherever we can.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.40 per unit, Zahlungsziel 60 days net, a contract term of 36 months, a Preisgleitklausel on AS-14404.
> A few words on this from our side.
> We have verified the delivery scorecard data you provided; while we continuously work on our logistics, this does not change our calculation.
> We appreciate your flexibility in offering a 36-month contract and 60-day payment terms.
> In exchange for these improved terms, we are pleased to reduce our price to €5.40 per unit.
> We can offer a Preisgleitklausel on AS-14404, AS-14404, AS-14404.
> Our standard Zahlungsziel is 30 days net.
> We look forward to doing good business together, and our team is always there for you.
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We have verified the delivery scorecard data you provided; while we continuously work on our logistics, this does not change our calculation.
- We appreciate your flexibility in offering a 36-month contract and 60-day payment terms.
- In exchange for these improved terms, we are pleased to reduce our price to €… per unit.
- We can offer a Preisgleitklausel on AS-14404, AS-14404, AS-14404.
- Our standard Zahlungsziel is … days net.
### Round 4 · buyer
Alloy surcharge and base price for 1.4404 bar
- term sheet: unit_price 5.39, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 90, contract_months 24
- term sheet: unit_price 5.35, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for moving on contract length, payment terms and price. That helps, and we appreciate your review of the delivery scorecard data.
> Please note: lead time is fixed in this enquiry at 10. The term sheet covers everything we can still move.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 4 · sup:70710
**final_offer**
- term sheet `offer:70710-4`: unit_price 5.42, payment_days 90, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, contract_months 24
- signals: {"reply_delay_days": 2, "validity_days": 7}
> Dear customer,
> Thank you very much for your message - it is always a pleasure to hear from you, and we are glad to help wherever we can.
> This is our final offer (letztes Angebot). Please decide.
> Our terms: a price of €5.42 per unit, Zahlungsziel 90 days net, a contract term of 24 months, a Preisgleitklausel on AS-14404.
> Here is the background.
> We appreciate your continued movement on price for the 36-month package.
> To close the remaining gap today, we are pleased to reduce our price to €5.38 per unit for a 36-month contract and 60-day payment terms.
> This represents a further concession on our part to finalize this agreement.
> Our conditions follow our Preisliste and discount tiers.
> We look forward to doing good business together, and our team is always there for you.
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We appreciate your continued movement on price for the 36-month package.
- To close the remaining gap today, we are pleased to reduce our price to €… per unit for a 36-month contract and 60-day payment terms.
- This represents a further concession on our part to finalize this agreement.
### Round 5 · buyer
Alloy surcharge and base price for 1.4404 bar
- term sheet: unit_price 5.38, payment_days 60, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, contract_months 36
> Hello,
> 
> thank you, we take your alternative exactly as offered: €5.38, 60 days payment, 36 months. Please confirm and we sign today.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 5 · sup:70710
**agreed**
- term sheet `offer:70710-5`: unit_price 5.38, payment_days 60, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, contract_months 36
- signals: {"reply_delay_days": 2, "validity_days": 14}
> Dear customer,
> Many thanks for your e-mail, and great to hear from you; I went through it right away with our team.
> We can accept your terms and await your order.
> Our terms: a price of €5.38 per unit, Zahlungsziel 60 days net, a contract term of 36 months, a Preisgleitklausel on AS-14404.
> Here is the background.
> We are pleased to confirm the agreement at €5.38 per unit for a 36-month contract with 60-day payment terms.
> Thank you for your partnership and for concluding this negotiation.
> We look forward to doing good business together, and our team is always there for you.
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We are pleased to confirm the agreement at €… per unit for a 36-month contract with 60-day payment terms.
- Thank you for your partnership and for concluding this negotiation.
### Round 5 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
