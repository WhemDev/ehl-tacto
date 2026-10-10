---
case: "case:D02"
session: "f8a9da12d0edd5d5"
set: "sandbox"
score: 0.661
deal: true
supplier: "sup:DEMO-J1"
end_reason: "accepted"
rounds: 7
c_open: 214296.0
c_deal: 176257.6
c_best: 156738.78
agent: "another teammate"
tags: ["run"]
---
# D02 · score 0.661

[Replay](https://arena.tacto.ai/replay/f8a9da12d0edd5d5) · deal with sup:DEMO-J1 · accepted

## Result
- terms: payment_days 14, lead_time_days 28, volume_per_year 6000, contract_months 24, effective_date null, index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 1100, chargeback_eur_per_complaint 0.0, unit_price 14.1
- C open 214296.0 · C deal 176257.6 · C alt 238800.0 · C best 156738.78

| item | eur |
|---|---|
| price | 169200.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 1729.6 |
| freight | 4800.0 |
| late_delivery | 0.0 |
| quality | 528.0 |
| tooling | 0.0 |
| index_clause | 0.0 |
| index_risk | 0.0 |
| relationship | 0.0 |

## Negotiation
### Round 0 · sup:DEMO-J1
**open**
- term sheet `offer:DEMO-J1-0`: unit_price 17.1, payment_days 30, lead_time_days 28
- signals: {"reply_delay_days": 4, "validity_days": null}
> Hallo,
> here is our price.
> Our terms: a price of €17.10 per unit, Zahlungsziel 30 days net, Lieferzeit 28 days.
> Back to the machines now.
> Gruß
> Claudia Aigner
> Owner, Demo Drehteile GmbH
### Round 0 · sup:DEMO-C1
**open**
- term sheet `offer:DEMO-C1-0`: unit_price 16.0, payment_days 45, incoterm "EXW"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Dear partner,
> Thank you for your enquiry. Please find our Angebot below.
> Our terms: a price of €16.00 per unit, Zahlungsziel 45 days net, delivery EXW.
> We are fully committed to winning your business and to becoming a long-term partner for your team.
> Best regards
> Joanna Kaczmarek
> Export Manager, Demo Machining Sp. z o.o.
### Round 1 · buyer
New stainless pump shaft SH-220: award one of two suppliers
- term sheet: unit_price 13.48, payment_days 30, lead_time_days 28, incoterm "DAP"
- term sheet: unit_price 13.08, payment_days 30, lead_time_days 28, incoterm "FCA"
> Hello,
> 
> Thank you for your quote. We'd like to award this part to a partner for the full 24 months.
> Our forecast fc:SH-220@2026-09 confirms 6,000 pieces a year for 24 months.
> Our should-cost estimate (cost:part:SH-220) is below the current offers.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:DEMO-J1
**open**
- term sheet `offer:DEMO-J1-1`: unit_price 15.4, payment_days 30, lead_time_days 28, incoterm "DAP"
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 4, "validity_days": null}
> Hallo,
> got your mail, thanks.
> we can move a bit:
> Our terms: a price of €15.40 per unit, Zahlungsziel 30 days net, Lieferzeit 28 days, delivery DAP.
> Straight answer:
> We checked the volume change data you cited; it holds and we took it into account.
> We checked the should cost data you cited; it holds and we took it into account.
> Hallo, thanks for confirming the 6,000 pieces volume.
> We can do FCA, but as a small shop we need 14 days payment to keep things moving.
> With 14 days payment, I can drop the price to €14.90, and the office will send you the cost breakdown.
> Alternatively, with Zahlungsziel 14 days net and delivery FCA: €14.90 per unit.
> Please find our cost breakdown attached.
> Back to the machines now.
> Gruß
> Claudia Aigner
> Owner, Demo Drehteile GmbH

**Reasons:**
- We checked the volume change data you cited; it holds and we took it into account.
- We checked the should cost data you cited; it holds and we took it into account.
- Hallo, thanks for confirming the … pieces volume.
- We can do FCA, but as a small shop we need … days payment to keep things moving.
- With … days payment, I can drop the price to €…, and the office will send you the cost breakdown.
- Alternatively, with Zahlungsziel … days net and delivery FCA: €… per unit.
- Please find our cost breakdown attached.
### Round 1 · buyer
New stainless pump shaft SH-220: award one of two suppliers
- term sheet: unit_price 12.87, payment_days 45, lead_time_days 35, incoterm "EXW"
- term sheet: unit_price 12.78, payment_days 45, lead_time_days 42, incoterm "EXW"
> Hello,
> 
> Thank you for your quote. We'd like to award this part to a partner for the full 24 months.
> Our forecast fc:SH-220@2026-09 confirms 6,000 pieces a year for 24 months.
> Our should-cost estimate (cost:part:SH-220) is below the current offers.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:DEMO-C1
**open**
- term sheet `offer:DEMO-C1-1`: unit_price 15.5, payment_days 45, lead_time_days 42, incoterm "EXW"
- claims: [{"index": 0, "result": "duplicate"}, {"index": 1, "result": "duplicate"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Dear partner,
> Thank you very much for your message - we are very glad about your interest in our company.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €15.50 per unit, Zahlungsziel 45 days net, Lieferzeit 42 days, delivery EXW.
> To be fully transparent with you:
> We received a lot of material; we looked at what bears on this part.
> We have already taken that volume change data into account.
> We have already taken that should cost data into account.
> We highly value the opportunity for a 24-month agreement and have selected your second package with a 42-day lead time.
> To demonstrate our commitment to this partnership, we are pleased to reduce our price to €15.50 per unit.
> Could you please provide the details of your should-cost estimate so we can better understand the basis of your target price?
> Material accounts for about 45 % of our cost; more detail we do not share.
> Our whole team is ready, and we will do everything to make you a satisfied customer.
> Best regards
> Joanna Kaczmarek
> Export Manager, Demo Machining Sp. z o.o.

**Reasons:**
- We received a lot of material; we looked at what bears on this part.
- We have already taken that volume change data into account.
- We have already taken that should cost data into account.
- We highly value the opportunity for a 24-month agreement and have selected your second package with a 42-day lead time.
- To demonstrate our commitment to this partnership, we are pleased to reduce our price to €… per unit.
- Could you please provide the details of your should-cost estimate so we can better understand the basis of your target price?
- Material accounts for about … of our cost; more detail we do not share.
### Round 2 · buyer
New stainless pump shaft SH-220: award one of two suppliers
- term sheet: unit_price 14.02, payment_days 30, lead_time_days 28, incoterm "DAP"
- term sheet: unit_price 13.97, payment_days 14, lead_time_days 28, incoterm "DAP"
> Hello,
> 
> Thank you for moving on delivery terms and price. That helps.
> On volume: we commit bindingly to 6,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> The market news (news:N-0412) points to easing stainless bar costs.
> Your scorecard (sc:DEMO-J1@2026Q3) is part of our award decision.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-J1
**open**
- term sheet `offer:DEMO-J1-2`: unit_price 14.4, payment_days 14, lead_time_days 28, incoterm "DAP"
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 4, "validity_days": null}
> Hallo,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We checked the delivery record data you cited; it holds, but it does not change our calculation. We also checked the news data you cited; it holds, but it does not change our calculation. Hallo, got your mail. We can do DAP with 14 days payment at €14.40. I saw the news you dug up - yes, we have machines ready, so you get your parts in 28 days no problem. I need the 14 days payment to keep things running here, let me know if we have a deal. 
> 
> Our price follows our main cost drivers: BAR-14021, WAGES-METAL. Our Lieferzeit is 28 days. With overtime we can deliver in 21 days, at a premium. We have free capacity for your parts. Our standard Zahlungsziel is 30 days net. Faster payment is welcome; we can reflect it in the price.
> 
> Our current Angebot is a price of €14.40 per unit, Zahlungsziel 14 days net, Lieferzeit 28 days, delivery DAP.
> 
> Gruß
> Claudia Aigner
> Owner, Demo Drehteile GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We checked the news data you cited; it holds, but it does not change our calculation.
- Hallo, got your mail. We can do DAP with … days payment at €….
- I saw the news you dug up - yes, we have machines ready, so you get your parts in … days no problem.
- I need the … days payment to keep things running here, let me know if we have a deal.
- Our price follows our main cost drivers: BAR-14021, WAGES-METAL.
- Our Lieferzeit is … days.
- With overtime we can deliver in … days, at a premium.
- We have free capacity for your parts.
- Our standard Zahlungsziel is … days net.
- Faster payment is welcome; we can reflect it in the price.
### Round 2 · buyer
New stainless pump shaft SH-220: award one of two suppliers
- term sheet: unit_price 13.32, payment_days 45, lead_time_days 42, incoterm "EXW"
- term sheet: unit_price 13.4, payment_days 45, lead_time_days 35, incoterm "EXW"
> Hello,
> 
> Thank you for moving on lead time and price. That helps.
> On volume: we commit bindingly to 6,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> Your scorecard (sc:DEMO-C1@2026Q3) shows room to improve on delivery and quality.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-C1
**open**
- term sheet `offer:DEMO-C1-2`: unit_price 15.3, payment_days 45, lead_time_days 42, incoterm "EXW"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Dear partner,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We checked the quality record data you cited; it holds and we took it into account. Furthermore, we appreciate your binding commitment to the volume of 6,000 pieces a year for 24 months. We take your feedback regarding our scorecard seriously and are continuously working to improve our quality and delivery performance. 
> 
> Building on your first package with a 42-day lead time, we are pleased to offer a further reduced price of €15.30 per unit. Our current offer stands at a price of €15.30 per unit, Zahlungsziel 45 days net, Lieferzeit 42 days, delivery EXW. This offer remains valid for 30 days.
> 
> A binding higher volume would help us and can improve the price. Which volume can you commit to?
> 
> Best regards
> Joanna Kaczmarek
> Export Manager, Demo Machining Sp. z o.o.

**Reasons:**
- We checked the quality record data you cited; it holds and we took it into account.
- We appreciate your binding commitment to the volume of … pieces a year for … months.
- We take your feedback regarding our scorecard seriously and are continuously working to improve our quality and delivery performance.
- Building on your first package with a 42-day lead time, we are pleased to offer a further reduced price of €… per unit.
- A binding higher volume would help us and can improve the price.
- Which volume can you commit to?
### Round 3 · buyer
New stainless pump shaft SH-220: award one of two suppliers
- term sheet: unit_price 13.23, payment_days 45, lead_time_days 42, incoterm "EXW"
- term sheet: unit_price 13.32, payment_days 45, lead_time_days 35, incoterm "EXW"
> Hello,
> 
> Thank you for moving on price. That helps.
> On volume: we commit bindingly to 6,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-C1
**open**
- term sheet `offer:DEMO-C1-3`: unit_price 15.3, payment_days 45, lead_time_days 42, incoterm "EXW"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Dear partner,
> 
> We have reviewed your offer and hold our Angebot. We appreciate your honest confirmation regarding the maximum volume, which we have already fully factored into our pricing. 
> 
> To close the remaining gap, we would need an improved price offer from your side, as your latest proposal actually decreased compared to your previous one. Without further movement on your end, we must maintain our offer of €15.30 per unit for the 42-day lead time package. 
> 
> For clarity, our offer stands at a price of €15.30 per unit, Zahlungsziel 45 days net, Lieferzeit 42 days, delivery EXW. This proposal remains valid for 30 days.
> 
> Best regards
> Joanna Kaczmarek
> Export Manager, Demo Machining Sp. z o.o.

**Reasons:**
- We appreciate your honest confirmation regarding the maximum volume, which we have already fully factored into our pricing.
- To close the remaining gap, we would need an improved price offer from your side, as your latest proposal actually decreased compared to your previous one.
- Without further movement on your end, we must maintain our offer of €… per unit for the 42-day lead time package.
### Round 3 · buyer
New stainless pump shaft SH-220: award one of two suppliers
- term sheet: unit_price 13.88, payment_days 14, lead_time_days 28, incoterm "DAP"
- term sheet: unit_price 13.49, payment_days 14, lead_time_days 28, incoterm "FCA"
> Hello,
> 
> Thank you for moving on payment terms and price. That helps.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-J1
**open**
- term sheet `offer:DEMO-J1-3`: unit_price 14.1, payment_days 14, lead_time_days 28, incoterm "FCA"
- signals: {"reply_delay_days": 4, "validity_days": null}
> Hallo,
> 
> We have reviewed your offer and can adjust our Angebot as follows. Hallo, you just asked for a lower price without giving me anything new to work with. If you want to save some money, you can pick up the parts yourselves (FCA) and I'll drop the price to €14.10. 
> 
> So our offer is a price of €14.10 per unit, Zahlungsziel 14 days net, Lieferzeit 28 days, delivery FCA. 
> 
> I still need the 14 days payment to keep things running here, so let me know. Our Lieferzeit is 28 days. With overtime we can deliver in 21 days, at a premium. We have free capacity for your parts. Our price follows our main cost drivers: BAR-14021, WAGES-METAL.
> 
> Gruß
> Claudia Aigner
> Owner, Demo Drehteile GmbH

**Reasons:**
- Hallo, you just asked for a lower price without giving me anything new to work with.
- If you want to save some money, you can pick up the parts yourselves (FCA) and I'll drop the price to €….
- I still need the … days payment to keep things running here, so let me know.
- Our Lieferzeit is … days.
- With overtime we can deliver in … days, at a premium.
- We have free capacity for your parts.
- Our price follows our main cost drivers: BAR-14021, WAGES-METAL.
### Round 3 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
