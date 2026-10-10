---
case: "case:P08"
session: "dffadf44789abd30"
set: "practice"
score: 0.607
deal: true
supplier: "sup:70710"
end_reason: "accepted"
rounds: 6
c_open: 1135887.28
c_deal: 1029228.43
c_best: 960309.33
agent: "hybrid+a9h-hold3"
commit: "c70bcf0"
tags: ["run"]
---
# P08 · score 0.607

[Replay](https://arena.tacto.ai/replay/dffadf44789abd30) · deal with sup:70710 · accepted

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
> 
> Thank you for your enquiry. Please find our Angebot below. We are pleased to present our offer for a price of €6.05 per unit, with a Zahlungsziel 30 days net, a contract term of 12 months, and no Preisgleitklausel. 
> 
> To give you some background on our current situation and market conditions, AS-14404 rose 5.9 % in twelve months and is 45 % of our cost. Furthermore, LCI-C rose 2.7 % in twelve months and is 5 % of our cost. Lastly, PPI-C2431 rose 12.3 % in twelve months and is 38 % of our cost. 
> 
> Please note that this offer remains valid for 30 days. We look forward to continuing our partnership with your team and supplying your needs from our extensive inventory.
> 
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- AS-14404 rose … in twelve months and is … of our cost.
- LCI-C rose … in twelve months and is … of our cost.
- PPI-C2431 rose … in twelve months and is … of our cost.
### Round 1 · buyer
Alloy surcharge and base price for 1.4404 bar (ref 4789)
- term sheet: unit_price 5.13, index_clause null, payment_days 90, contract_months 24
- term sheet: unit_price 5.08, index_clause null, payment_days 45, contract_months 36
> Hello,
> 
> Thank you for your quote. We'd like to award this part to a partner for the full 24 months.
> We currently buy the same part from another supplier at EUR 5.84 per unit.
> Alloy surcharge 1.4404, Isartal Edelstahlwerk (fictional mill, derived) fell -5.5% from 2026-06 to 2026-09 (idx:AS-14404@2026-06, idx:AS-14404@2026-09).
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:70710
**open**
- term sheet `offer:70710-1`: unit_price 5.45, payment_days 90, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 0.0, "base_month": "2026-08"}, contract_months 24
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We checked the index change data you cited; it holds, but it does not change our calculation. That is not our reality: our AS-14404 is covered at fixed prices until March 2027, so that fall does not reach our cost. While we note the recent index decrease, our current material supplies are covered at fixed prices, meaning the drop does not yet reduce our costs; nevertheless, we have applied a goodwill reduction. Material accounts for about 45 % of our cost; more detail we do not share. AS-14404 rose 5.9 % in twelve months and is 45 % of our cost. That remains. LCI-C rose 2.7 % in twelve months and is 5 % of our cost. That remains. PPI-C2431 rose 12.3 % in twelve months and is 38 % of our cost. That remains.
> 
> We welcome the opportunity for a 24-month partnership and have structured our revised offer to accommodate your requested 90-day payment terms, provided we introduce an AS-14404 index clause to manage long-term volatility.
> 
> Our offer is a price of €5.45 per unit, Zahlungsziel 90 days net, a contract term of 24 months, a Preisgleitklausel on AS-14404. 
> 
> Alternatively, with a Preisgleitklausel on AS-14404: €5.57 per unit, with a price of €5.57 per unit, Zahlungsziel 90 days net, a contract term of 24 months, a Preisgleitklausel on AS-14404.
> 
> Please send us the competing offer you mentioned. Our offer stays valid for 30 days.
> 
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We checked the index change data you cited; it holds, but it does not change our calculation.
- That is not our reality: our AS-14404 is covered at fixed prices until March … so that fall does not reach our cost.
- AS-14404 rose … in twelve months and is … of our cost. That remains.
- LCI-C rose … in twelve months and is … of our cost. That remains.
- PPI-C2431 rose … in twelve months and is … of our cost. That remains.
- We welcome the opportunity for a 24-month partnership and have structured our revised offer to accommodate your requested 90-day payment terms, provided we introduce an AS-14404 index clause to manage long-term volatility.
- While we note the recent index decrease, our current material supplies are covered at fixed prices, meaning the drop does not yet reduce our costs; nevertheless, we have applied a goodwill reduction.
- Alternatively, with a Preisgleitklausel on AS-14404: €… per unit.
- Please send us the competing offer you mentioned.
- Material accounts for about … of our cost; more detail we do not share.
### Round 2 · buyer
Alloy surcharge and base price for 1.4404 bar (ref 3748)
- term sheet: unit_price 5.29, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 90, contract_months 24
- term sheet: unit_price 5.24, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 45, contract_months 36
> Hello,
> 
> Thank you for moving on contract length and index_clause and payment terms and price. That helps.
> Producer prices DE: cold drawing of bars fell -2.1% from 2026-05 to 2026-08 (idx:PPI-C2431@2026-05, idx:PPI-C2431@2026-08).
> Our recent orders po:4500014455-10, po:4500014391-10, po:4500014305-10 show the price level we have been paying.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:70710
**open**
- term sheet `offer:70710-2`: unit_price 5.47, payment_days 90, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, contract_months 24
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We checked the index change data you cited; it holds and we took it into account. We checked the price history data you cited; it holds, but it does not change our calculation. AS-14404 rose 5.9 % in twelve months and is 45 % of our cost. That remains. LCI-C rose 2.7 % in twelve months and is 5 % of our cost. That remains. PPI-C2431 rose 12.3 % in twelve months and is 38 % of our cost. That remains. We have verified the recent decrease in PPI-C2431, which slightly reduces our cost basis, and we are passing this saving on to you. Our price follows our main cost drivers: AS-14404, PPI-C2431, LCI-C.
> 
> Our current offer is a price of €5.47 per unit, Zahlungsziel 90 days net, a contract term of 24 months, a Preisgleitklausel on AS-14404. As an alternative, we propose €5.42 per unit for the 36-month package with 45-day payment terms and the AS-14404 index clause. 
> 
> We can offer a Preisgleitklausel on AS-14404, AS-14404, AS-14404. Our standard terms apply to everything the quote does not state; see attached. This offer is valid for 30 days.
> 
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We checked the index change data you cited; it holds and we took it into account.
- We checked the price history data you cited; it holds, but it does not change our calculation.
- AS-14404 rose … in twelve months and is … of our cost. That remains.
- LCI-C rose … in twelve months and is … of our cost. That remains.
- PPI-C2431 rose … in twelve months and is … of our cost. That remains.
- We have verified the recent decrease in PPI-C2431, which slightly reduces our cost basis, and we are passing this saving on to you.
- We propose €… per unit for the 36-month package with 45-day payment terms and the AS-14404 index clause.
- Our price follows our main cost drivers: AS-14404, PPI-C2431, LCI-C.
- Our standard terms apply to everything the quote does not state; see attached.
- We can offer a Preisgleitklausel on AS-14404, AS-14404, AS-14404.
### Round 3 · buyer
Alloy surcharge and base price for 1.4404 bar (ref 6414)
- term sheet: unit_price 5.33, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 90, contract_months 24
- term sheet: unit_price 5.3, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for moving on index_clause and price. That helps.
> Your scorecard sc:70710@2026Q3 shows 88.0% on-time delivery.
> In your last 3 renewals of this part we settled on average 3.1 points below your initial ask.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:70710
**open**
- term sheet `offer:70710-3`: unit_price 5.41, payment_days 60, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, contract_months 36
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We checked the delivery record data you cited; it holds, but it does not change our calculation. We have reviewed your feedback regarding our delivery scorecard; while we continuously strive for excellence, this metric does not alter our underlying cost structure. Furthermore, past negotiation outcomes are not indicative of current market conditions, as our pricing strictly reflects our present cost drivers. Our price follows our main cost drivers: AS-14404, PPI-C2431, LCI-C.
> 
> Our current Angebot stands at a price of €5.41 per unit, Zahlungsziel 60 days net, a contract term of 36 months, a Preisgleitklausel on AS-14404. To help close the gap, we can reduce our price to €5.44 for the 24-month contract with 90-day payment terms. As an alternative, we offer a price of €5.44 per unit, Zahlungsziel 90 days net, a contract term of 24 months, a Preisgleitklausel on AS-14404.
> 
> Please note that our offer stays valid for 30 days.
> 
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We have reviewed your feedback regarding our delivery scorecard; while we continuously strive for excellence, this metric does not alter our underlying cost structure.
- Past negotiation outcomes are not indicative of current market conditions, as our pricing strictly reflects our present cost drivers.
- To help close the gap, we can reduce our price to €… for the 24-month contract with 90-day payment terms.
- Our price follows our main cost drivers: AS-14404, PPI-C2431, LCI-C.
### Round 4 · buyer
Alloy surcharge and base price for 1.4404 bar (ref 8710)
- term sheet: unit_price 5.38, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 90, contract_months 24
- term sheet: unit_price 5.35, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for moving on contract length and payment terms and price. That helps.
> Please note: lead time is fixed in this enquiry at 10. The term sheet covers everything we can still move.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 4 · sup:70710
**open**
- term sheet `offer:70710-4`: unit_price 5.38, payment_days 60, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, contract_months 36
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We appreciate your continued movement on price, which brings us closer to an agreement. To help close the remaining gap today, we can reduce our price to €5.38 for the 36-month contract with 60-day payment terms.
> 
> Our full terms stand at a price of €5.38 per unit, Zahlungsziel 60 days net, a contract term of 36 months, and a Preisgleitklausel on AS-14404. 
> 
> Please note that this proposal remains valid for 30 days. We look forward to continuing our successful partnership and securing these excellent conditions for your material requirements.
> 
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We appreciate your continued movement on price, which brings us closer to an agreement.
- To help close the remaining gap today, we can reduce our price to €… for the 36-month contract with 60-day payment terms.
### Round 5 · buyer
Alloy surcharge and base price for 1.4404 bar (ref 1003)
- term sheet: unit_price 5.36, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 90, contract_months 24
- term sheet: unit_price 5.33, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5, "base_month": "2026-08"}, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for moving on price. That helps.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 5 · sup:70710
**final_offer**
- term sheet `offer:70710-5`: unit_price 5.38, payment_days 60, index_clause {"series": "AS-14404", "material_share": 0.45, "deadband_pct": 5.0, "base_month": "2026-08"}, contract_months 36
- signals: {"reply_delay_days": 2, "validity_days": 7}
> Dear customer,
> 
> We appreciate your prompt reply, but without new data or further movement on your side, we cannot adjust our calculation. Our offer of €5.38 for the 36-month contract with 60-day payment terms represents our limit under the current cost structure. 
> 
> This is our final offer (letztes Angebot). Please decide. For your review, our Angebot stands at a price of €5.38 per unit, Zahlungsziel 60 days net, a contract term of 36 months, and a Preisgleitklausel on AS-14404. Please note that this offer remains valid for 7 days.
> 
> Our offer of €5.38 for the 36-month contract with 60-day payment terms represents our limit under the current cost structure. We kindly ask you to accept this proposal so we can finalize the agreement and secure your material requirements.
> 
> Mit freundlichen Grüßen
> Georg Aigner
> Inside Sales, Edelstahl-Service Donautal GmbH

**Reasons:**
- We appreciate your prompt reply, but without new data or further movement on your side, we cannot adjust our calculation.
- Our offer of €… for the 36-month contract with 60-day payment terms represents our limit under the current cost structure.
- We kindly ask you to accept this proposal so we can finalize the agreement and secure your material requirements.
### Round 5 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
