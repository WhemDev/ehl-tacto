---
case: "case:P07"
session: "48ab6ad4e6b5da8c"
set: "practice"
score: 0.691
deal: true
supplier: "sup:70610"
end_reason: "accepted"
rounds: 5
c_open: 391027.4
c_deal: 327628.8
c_best: 299241.49
agent: "hybrid+a9h3-tpl"
commit: "a648f51"
tags: ["run"]
---
# P07 · score 0.691

[Replay](https://arena.tacto.ai/replay/48ab6ad4e6b5da8c) · deal with sup:70610 · accepted

## Result
- terms: payment_days 60, lead_time_days 5, volume_per_year 30000, contract_months 36, effective_date "2027-01-01", index_clause null, incoterm "DAP", tooling_eur 0.0, ppm_commitment 80, chargeback_eur_per_complaint 0.0, unit_price 5.46
- C open 391027.4 · C deal 327628.8 · C alt 379916.0 · C best 299241.49

| item | eur |
|---|---|
| price | 327600.0 |
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
Bundle the fastener kit with one distributor (ref 1130)
- term sheet: unit_price 5.33, payment_days 90, contract_months 24
- term sheet: unit_price 5.29, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for your quote. We'd like to award this part to a partner for the full 24 months.
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
> Many thanks for your e-mail, and great to hear from you; I went through it right away with our team.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.60 per unit, Zahlungsziel 90 days net, a contract term of 24 months.
> Here is the background.
> We checked the delivery record data you cited; it holds, but it does not change our calculation.
> We checked the price history data you cited; it holds, but it does not change our calculation.
> We appreciate the opportunity to consolidate this volume and are pleased to support the 24-month contract term you requested.
> To provide you with a competitive price for this bundle, we must maintain our standard 30-day payment terms.
> Alternatively, with Zahlungsziel 30 days net: €5.53 per unit.
> Material accounts for about 61 % of our cost; more detail we do not share.
> And while we are at it: our whole range is at your disposal, so if there is anything else on your list, just send it over - we are happy to quote.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We checked the price history data you cited; it holds, but it does not change our calculation.
- We appreciate the opportunity to consolidate this volume and are pleased to support the 24-month contract term you requested.
- To provide you with a competitive price for this bundle, we must maintain our standard 30-day payment terms.
- Alternatively, with Zahlungsziel … days net: €… per unit.
- Material accounts for about … of our cost; more detail we do not share.
### Round 2 · buyer
Bundle the fastener kit with one distributor (ref 2778)
- term sheet: unit_price 5.39, payment_days 90, contract_months 24
- term sheet: unit_price 5.36, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for moving on contract length and payment terms and price. That helps.
> On volume: we commit bindingly to 30,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
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
- term sheet `offer:70610-2`: unit_price 5.52, payment_days 60, contract_months 36
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Many thanks for your e-mail, and great to hear from you; I went through it right away with our team.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.52 per unit, Zahlungsziel 60 days net, a contract term of 36 months.
> Here is the background.
> We have verified your forecast data and factored the binding volume of 30,000 pieces into our calculation.
> For the 90-day payment term and 24-month contract you requested, we can offer €5.55 per unit.
> A binding higher volume would help us and can improve the price.
> Which volume can you commit to?
> And while we are at it: our whole range is at your disposal, so if there is anything else on your list, just send it over - we are happy to quote.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We have verified your forecast data and factored the binding volume of … pieces into our calculation.
- For the 90-day payment term and 24-month contract you requested, we can offer €… per unit.
- A binding higher volume would help us and can improve the price.
- Which volume can you commit to?
### Round 3 · buyer
Bundle the fastener kit with one distributor (ref 5648)
- term sheet: unit_price 5.44, payment_days 90, contract_months 24
- term sheet: unit_price 5.41, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for moving on contract length and payment terms and price. That helps.
> On volume: we commit bindingly to 30,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:70610
**open**
- term sheet `offer:70610-3`: unit_price 5.48, payment_days 60, contract_months 36
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Many thanks for your e-mail, and great to hear from you; I went through it right away with our team.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.48 per unit, Zahlungsziel 60 days net, a contract term of 36 months.
> A few words on this from our side.
> We appreciate your clear communication regarding the maximum binding volume of 30,000 pieces.
> To help close the remaining gap today, we have adjusted our Angebot to €5.48 per unit for the 36-month contract with 60-day payment terms.
> This concession reflects our strong interest in a long-term partnership and brings us significantly closer to an agreement.
> Which figures is that based on? Please send us the data.
> We look forward to doing good business together, and our team is always there for you.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We appreciate your clear communication regarding the maximum binding volume of … pieces.
- To help close the remaining gap today, we have adjusted our Angebot to €… per unit for the 36-month contract with 60-day payment terms.
- This concession reflects our strong interest in a long-term partnership and brings us significantly closer to an agreement.
- Which figures is that based on? Please send us the data.
### Round 4 · buyer
Bundle the fastener kit with one distributor (ref 8885)
- term sheet: unit_price 5.47, payment_days 90, contract_months 24
- term sheet: unit_price 5.44, payment_days 60, contract_months 36
> Hello,
> 
> Thank you for moving on price. That helps.
> On volume: we commit bindingly to 30,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> You asked for the data behind our figures: it is attached.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 4 · sup:70610
**final_offer**
- term sheet `offer:70610-4`: unit_price 5.46, payment_days 60, contract_months 36
- claims: [{"index": 0, "result": "duplicate"}, {"index": 1, "result": "duplicate"}, {"index": 2, "result": "duplicate"}]
- signals: {"reply_delay_days": 2, "validity_days": 7}
> Dear customer,
> Many thanks for your e-mail, and great to hear from you; I went through it right away with our team.
> This is our final offer (letztes Angebot). Please decide.
> Our terms: a price of €5.46 per unit, Zahlungsziel 60 days net, a contract term of 36 months.
> Here is the background.
> We received a lot of material; we looked at what bears on this part.
> We have already taken that quality record data into account.
> We have already taken that price history data into account.
> We have already taken that volume change data into account.
> We have reviewed the attached data; as it was already factored into our previous calculation, it does not change our position further.
> However, to help close the remaining gap today, we can reduce our price to €5.46 per unit for the 36-month contract with 60-day payment terms.
> This offer represents our strong commitment to supporting your entire need for this part.
> Our price follows our main cost drivers: PPI-C2594, LCI-C.
> A binding higher volume would help us and can improve the price.
> Which volume can you commit to?
> Our conditions follow our Preisliste and discount tiers.
> We look forward to doing good business together, and our team is always there for you.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We received a lot of material; we looked at what bears on this part.
- We have already taken that quality record data into account.
- We have already taken that price history data into account.
- We have already taken that volume change data into account.
- We have reviewed the attached data; as it was already factored into our previous calculation, it does not change our position further.
- However, to help close the remaining gap today, we can reduce our price to €… per unit for the 36-month contract with 60-day payment terms.
- This offer represents our strong commitment to supporting your entire need for this part.
- Our price follows our main cost drivers: PPI-C2594, LCI-C.
- A binding higher volume would help us and can improve the price.
- Which volume can you commit to?
### Round 4 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
