---
case: "case:P07"
session: "cb3f4e09bbed6c2e"
set: "practice"
score: 0.671
deal: true
supplier: "sup:70610"
end_reason: "accepted"
rounds: 5
c_open: 391027.4
c_deal: 329428.8
c_best: 299241.49
agent: "hybrid+a9i-fresh"
commit: "26c9b1e"
tags: ["run"]
---
# P07 · score 0.671

[Replay](https://arena.tacto.ai/replay/cb3f4e09bbed6c2e) · deal with sup:70610 · accepted

## Result
- terms: payment_days 60, lead_time_days 5, volume_per_year 30000, contract_months 36, effective_date "2027-01-01", index_clause null, incoterm "DAP", tooling_eur 0.0, ppm_commitment 80, chargeback_eur_per_complaint 0.0, unit_price 5.49
- C open 391027.4 · C deal 329428.8 · C alt 379916.0 · C best 299241.49

| item | eur |
|---|---|
| price | 329400.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 0.0 |
| freight | 0.0 |
| late_delivery | 0.0 |
| quality | 28.8 |
| tooling | 0.0 |
| index_clause | 0.0 |
| index_risk | 0.0 |
| relationship | 0.0 |

## Negotiation
### Round 0 · sup:70610
**open**
- term sheet `offer:70610-0`: unit_price 5.74, payment_days 30, contract_months 12
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Thank you for your enquiry. Please find our Angebot below.
> Our terms: a price of €5.74 per unit, Zahlungsziel 30 days net, a contract term of 12 months.
> And while we are at it: our whole range is at your disposal, so if there is anything else on your list, just send it over - we are happy to quote.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH
### Round 1 · buyer
Bundle the fastener kit with one distributor
- term sheet: unit_price 5.33, payment_days 90, contract_months 24
- term sheet: unit_price 5.29, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for your quote and for the clear summary of your terms. We appreciate the time you put into it.
> 
> We'd like to award this part to a partner for the full 24 months.
> Our recent orders po:4500014475-10, po:4500014403-10, po:4500014328-10 show the price level we have been paying.
> Your scorecard sc:70610@2026Q3 shows 88.6% on-time delivery.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> The bundle moves about 1,268,800 pieces a year that we buy from other suppliers today to you.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:70610
**open**
- term sheet `offer:70610-1`: unit_price 5.6, payment_days 90, contract_months 24
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Thank you very much for your message - it is always a pleasure to hear from you, and we are glad to help wherever we can.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.60 per unit, Zahlungsziel 90 days net, a contract term of 24 months.
> Here is the background.
> We checked the delivery record data you cited; it holds, but it does not change our calculation.
> We checked the price history data you cited; it holds, but it does not change our calculation.
> We highly value the opportunity to consolidate this volume and establish a 24-month partnership.
> To make this price possible, we must maintain our standard 30-day payment terms rather than extending to 90 days.
> Alternatively, with Zahlungsziel 30 days net: €5.53 per unit.
> Material accounts for about 61 % of our cost; more detail we do not share.
> We look forward to doing good business together, and our team is always there for you.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We checked the price history data you cited; it holds, but it does not change our calculation.
- We highly value the opportunity to consolidate this volume and establish a 24-month partnership.
- To make this price possible, we must maintain our standard 30-day payment terms rather than extending to … days.
- Alternatively, with Zahlungsziel … days net: €… per unit.
- Material accounts for about … of our cost; more detail we do not share.
### Round 2 · buyer
Bundle the fastener kit with one distributor
- term sheet: unit_price 5.46, payment_days 90, contract_months 24
- term sheet: unit_price 5.43, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for your reply and for checking the data we cited. We appreciate your interest in a 24-month partnership and your willingness to adjust your offer.
> 
> On volume: we commit bindingly to 30,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more. Lead time, delivery terms, start date and tooling are fixed in this enquiry, so we would like to keep them as they are.
> 
> In your last 3 renewals of this part we settled on average 2.7 points below your initial ask.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Our current forecast (fc:360010@2026-09) backs this binding volume.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:70610
**open**
- term sheet `offer:70610-2`: unit_price 5.51, payment_days 60, contract_months 36
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Thank you very much for your message - it is always a pleasure to hear from you, and we are glad to help wherever we can.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.51 per unit, Zahlungsziel 60 days net, a contract term of 36 months.
> Here is the background.
> We have verified your forecast data, and the confirmed volume allows us to adjust our calculation.
> We can offer €5.54 per unit for the 24-month contract with 90-day payment terms.
> A binding higher volume would help us and can improve the price.
> Which volume can you commit to?
> And while we are at it: our whole range is at your disposal, so if there is anything else on your list, just send it over - we are happy to quote.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We have verified your forecast data, and the confirmed volume allows us to adjust our calculation.
- We can offer €… per unit for the 24-month contract with 90-day payment terms.
- A binding higher volume would help us and can improve the price.
- Which volume can you commit to?
### Round 3 · buyer
Bundle the fastener kit with one distributor
- term sheet: unit_price 5.48, payment_days 90, contract_months 24
- term sheet: unit_price 5.44, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for moving on contract length and payment terms and price. That helps.
> On volume: we commit bindingly to 30,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more. Volume is fixed in this enquiry, so we cannot offer a higher figure.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:70610
**open**
- term sheet `offer:70610-3`: unit_price 5.53, payment_days 90, contract_months 24
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Thank you very much for your message - it is always a pleasure to hear from you, and we are glad to help wherever we can.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.53 per unit, Zahlungsziel 90 days net, a contract term of 24 months.
> Here is the background.
> We appreciate your transparency regarding the fixed volume of 30,000 pieces per year.
> To help close the remaining gap, we can reduce our price to €5.49 per unit for the 36-month contract with 60-day payment terms.
> This represents a fair compromise given the fixed parameters of this enquiry.
> Which figures is that based on? Please send us the data.
> And while we are at it: our whole range is at your disposal, so if there is anything else on your list, just send it over - we are happy to quote.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We appreciate your transparency regarding the fixed volume of … pieces per year.
- To help close the remaining gap, we can reduce our price to €… per unit for the 36-month contract with 60-day payment terms.
- This represents a fair compromise given the fixed parameters of this enquiry.
- Which figures is that based on? Please send us the data.
### Round 4 · buyer
Bundle the fastener kit with one distributor
- term sheet: unit_price 5.49, payment_days 60, contract_months 36
> Hello,
> 
> thank you, we take your alternative exactly as offered: €5.49, 60 days payment, 36 months. Please confirm and we sign today.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 4 · sup:70610
**agreed**
- term sheet `offer:70610-4`: unit_price 5.49, payment_days 60, contract_months 36
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Thank you very much for your message - it is always a pleasure to hear from you, and we are glad to help wherever we can.
> We can accept your terms and await your order.
> Our terms: a price of €5.49 per unit, Zahlungsziel 60 days net, a contract term of 36 months.
> A few words on this from our side.
> We are pleased to confirm the agreement on the terms of €5.49 per unit, 60 days payment, and a 36-month contract.
> Thank you for your trust and we look forward to a successful partnership.
> And while we are at it: our whole range is at your disposal, so if there is anything else on your list, just send it over - we are happy to quote.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We are pleased to confirm the agreement on the terms of €… per unit, … days payment, and a 36-month contract.
- Thank you for your trust and we look forward to a successful partnership.
### Round 4 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
