---
case: "case:P03"
session: "1d2d4ccbb94a5b6c"
set: "practice"
score: 0.924
deal: true
supplier: "sup:70530"
end_reason: "accepted"
rounds: 4
c_open: 4246314.02
c_deal: 3934826.49
c_best: 3909043.1
agent: "hybrid+a9h-fresh"
commit: "0629629"
tags: ["run"]
---
# P03 · score 0.924

[Replay](https://arena.tacto.ai/replay/1d2d4ccbb94a5b6c) · deal with sup:70530 · accepted

## Result
- terms: payment_days 90, lead_time_days 49, volume_per_year 4580, contract_months 24, effective_date "2027-01-01", index_clause null, incoterm "DAP", tooling_eur 0.0, ppm_commitment 350, chargeback_eur_per_complaint 0.0, unit_price 432.12
- C open 4246314.02 · C deal 3934826.49 · C alt 4332545.92 · C best 3909043.1

| item | eur |
|---|---|
| price | 3958219.2 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | -26388.13 |
| freight | 0.0 |
| late_delivery | 0.0 |
| quality | 2000.54 |
| tooling | 0.0 |
| index_clause | 0.0 |
| index_risk | 0.0 |
| relationship | 994.88 |

## Negotiation
### Round 0 · sup:70530
**open**
- term sheet `offer:70530-0`: unit_price 438.21, payment_days 30, contract_months 12, volume_per_year 4580
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear Sir or Madam,
> Thank you for your enquiry. Please find our Angebot below.
> Our terms: a price of €438.21 per unit, Zahlungsziel 30 days net, a volume of 4580 pcs per year, a contract term of 12 months.
> For your information:
> CU-NOTATION rose 47.7 % in twelve months and is 5 % of our cost.
> LCI-C rose 2.7 % in twelve months and is 16 % of our cost.
> PPI-C2611 rose 13.5 % in twelve months and is 42 % of our cost.
> Should you require further information, please let us know.
> Mit freundlichen Grüßen
> Birgit Mayrhofer
> Key Account Manager, Selvbrunn Drive Systems GmbH

**Reasons:**
- CU-NOTATION rose … in twelve months and is … of our cost.
- LCI-C rose … in twelve months and is … of our cost.
- PPI-C2611 rose … in twelve months and is … of our cost.
### Round 1 · buyer
Frame agreement renewal for the 7.5 kW frequency converter (ref 8318)
- term sheet: unit_price 423.72, payment_days 90, contract_months 24, volume_per_year 4580
- term sheet: unit_price 421.92, payment_days 60, contract_months 36, volume_per_year 4580
> Hello,
> 
> Thank you for your quote. We'd like to award this part to a partner for the full 24 months.
> Our bottom-up should-cost estimate for this part is €403.21 (cost:350020).
> Our recent orders po:4500014465-10, po:4500014417-10, po:4500014351-10 show the price level we have been paying.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:70530
**open**
- term sheet `offer:70530-1`: unit_price 432.29, payment_days 90, contract_months 24, volume_per_year 4580
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear Sir or Madam,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We checked the price history data you cited; it holds, but it does not change our calculation. We checked the should cost data you cited; it holds and we took it into account. Material accounts for about 42 % of our cost; more detail we do not share. Our colleagues will provide the requested cost breakdown in a separate communication.
> 
> Our management has frozen all price reductions until December 2027. We can talk about the terms instead - payment, volume or contract length. We appreciate the opportunity to secure a long-term partnership and can accept the proposed 36-month contract duration. 
> 
> Our current Angebot is a price of €432.29 per unit, Zahlungsziel 90 days net, a volume of 4580 pcs per year, a contract term of 24 months. 
> 
> Alternatively, with a price of €429.36 per unit, Zahlungsziel 30 days net, a volume of 4580 pcs per year, a contract term of 36 months.
> 
> This offer is valid for 30 days.
> 
> Mit freundlichen Grüßen
> Birgit Mayrhofer
> Key Account Manager, Selvbrunn Drive Systems GmbH

**Reasons:**
- We checked the price history data you cited; it holds, but it does not change our calculation.
- We checked the should cost data you cited; it holds and we took it into account.
- Our management has frozen all price reductions until December …. We can talk about the terms instead - payment, volume or contract length.
- We appreciate the opportunity to secure a long-term partnership and can accept the proposed 36-month contract duration.
- Our colleagues will provide the requested cost breakdown in a separate communication.
- Alternatively, with Zahlungsziel … days net and a contract term of … months: €… per unit.
- Material accounts for about … of our cost; more detail we do not share.
### Round 2 · buyer
Frame agreement renewal for the 7.5 kW frequency converter (ref 7177)
- term sheet: unit_price 420.74, payment_days 90, contract_months 24, volume_per_year 4580
- term sheet: unit_price 418.95, payment_days 60, contract_months 36, volume_per_year 4580
> Hello,
> 
> Thank you for moving on contract length and payment terms and price. That helps.
> On volume: we commit bindingly to 4,580 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> Your scorecard sc:70530@2026Q3 shows 84.6% on-time delivery.
> Our forecast fc:350020@2026-09 shows demand +10.3%.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Our current forecast (fc:350020@2026-09) backs this binding volume.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:70530
**open**
- term sheet `offer:70530-2`: unit_price 432.12, payment_days 90, contract_months 24, volume_per_year 4580
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear Sir or Madam,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We have verified your delivery scorecard and volume forecast; this data has been factored into our updated calculation. As to the delivery record and volume change data you cited, our management has frozen all price reductions until December 2027. We can talk about the terms instead - payment, volume or contract length. 
> 
> Our current Angebot is a price of €432.12 per unit, Zahlungsziel 90 days net, a volume of 4580 pcs per year, a contract term of 24 months. As an alternative, as our price reductions are frozen, we can offer a price of €430.65 per unit, Zahlungsziel 60 days net, a volume of 4580 pcs per year, a contract term of 36 months. 
> 
> Which volume can you commit to? A binding higher volume would help us and can improve the price. 
> 
> This offer is valid for 30 days.
> 
> Mit freundlichen Grüßen
> Birgit Mayrhofer
> Key Account Manager, Selvbrunn Drive Systems GmbH

**Reasons:**
- As to the delivery record and volume change data you cited, our management has frozen all price reductions until December …. We can talk about the terms instead - payment, volume or contract length.
- We have verified your delivery scorecard and volume forecast; this data has been factored into our updated calculation.
- As our price reductions are frozen, we can offer €… for the 36-month contract with 60-day payment terms.
- Which volume can you commit to?
- A binding higher volume would help us and can improve the price.
### Round 3 · buyer
Frame agreement renewal for the 7.5 kW frequency converter (ref 2598)
- term sheet: unit_price 424.68, payment_days 90, contract_months 24, volume_per_year 4580
- term sheet: unit_price 418.95, payment_days 60, contract_months 36, volume_per_year 4580
> Hello,
> 
> Thank you for moving on price. That helps.
> Please note: lead time is fixed in this enquiry at 49. The term sheet covers everything we can still move.
> On volume: we commit bindingly to 4,580 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> In your last 3 renewals of this part we settled on average 2.2 points below your initial ask.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:70530
**open**
- term sheet `offer:70530-3`: unit_price 432.12, payment_days 90, contract_months 24, volume_per_year 4580
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear Sir or Madam,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We acknowledge your revised offer for the 24-month term, but as communicated, our management has strictly frozen all price reductions until December 2027. 
> 
> Please provide the documentation for the historical settlement data you referenced, as we cannot verify this claim internally.
> 
> In accordance with our pricing guidelines, our current Angebot comprises a price of €432.12 per unit, Zahlungsziel 90 days net, a volume of 4580 pcs per year, and a contract term of 24 months. This offer stays valid for 30 days.
> 
> Mit freundlichen Grüßen
> Birgit Mayrhofer
> Key Account Manager, Selvbrunn Drive Systems GmbH

**Reasons:**
- We acknowledge your revised offer for the 24-month term, but as communicated, our management has strictly frozen all price reductions until December ….
- Please provide the documentation for the historical settlement data you referenced, as we cannot verify this claim internally.
### Round 3 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
