---
case: "case:D02"
session: "faf1e7f58e463bdf"
set: "sandbox"
score: 0.577
deal: true
supplier: "sup:DEMO-J1"
end_reason: "accepted"
rounds: 8
c_open: 214296.0
c_deal: 181106.67
c_best: 156738.78
agent: "hybrid+a9-clock"
commit: "ddd9b13"
tags: ["run"]
---
# D02 · score 0.577

[Replay](https://arena.tacto.ai/replay/faf1e7f58e463bdf) · deal with sup:DEMO-J1 · accepted

## Result
- terms: payment_days 14, lead_time_days 28, volume_per_year 6000, contract_months 24, effective_date null, index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 1100, chargeback_eur_per_complaint 0.0, unit_price 14.5
- C open 214296.0 · C deal 181106.67 · C alt 238800.0 · C best 156738.78

| item | eur |
|---|---|
| price | 174000.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 1778.67 |
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
New stainless pump shaft SH-220: award one of two suppliers (ref 5572)
- term sheet: unit_price 12.09, payment_days 14, lead_time_days 35, incoterm "EXW"
> Hello,
> 
> Thank you for your quote. We'd like to award this part to a partner for the full 24 months.
> Our forecast fc:SH-220@2026-09 confirms 6,000 pieces a year for 24 months.
> Our proposal is attached as a term sheet.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:DEMO-C1
**open**
- term sheet `offer:DEMO-C1-1`: unit_price 16.6, payment_days 14, lead_time_days 35, incoterm "EXW"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Dear partner,
> Many thanks for your reply; we really appreciate the chance to work with you.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €16.60 per unit, Zahlungsziel 14 days net, Lieferzeit 35 days, delivery EXW.
> To be fully transparent with you:
> We checked the volume change data you cited; it holds and we took it into account.
> We appreciate the confirmed volume of 6,000 pieces per year for 24 months, which allows us to optimize our planning.
> To ensure reliable delivery and maintain our quality standards, we must request a 45-day lead time.
> Alternatively, with Lieferzeit 45 days: €15.70 per unit.
> Material accounts for about 45 % of our cost; more detail we do not share.
> Our whole team is ready, and we will do everything to make you a satisfied customer.
> Best regards
> Joanna Kaczmarek
> Export Manager, Demo Machining Sp. z o.o.

**Reasons:**
- We checked the volume change data you cited; it holds and we took it into account.
- We appreciate the confirmed volume of … pieces per year for … months, which allows us to optimize our planning.
- To ensure reliable delivery and maintain our quality standards, we must request a 45-day lead time.
- Alternatively, with Lieferzeit … days: €… per unit.
- Material accounts for about … of our cost; more detail we do not share.
### Round 1 · buyer
New stainless pump shaft SH-220: award one of two suppliers (ref 2060)
- term sheet: unit_price 12.74, payment_days 14, lead_time_days 28, incoterm "DAP"
> Hello,
> 
> Thank you for your quote. We'd like to award this part to a partner for the full 24 months.
> Our forecast fc:SH-220@2026-09 confirms 6,000 pieces a year for 24 months.
> For transparency: another supplier's standing offer (offer:DEMO-C1-1) is €16.60, 14 days payment, 35 days lead time, EXW; I attach it. We'd prefer to give the order to you.
> Our proposal is attached as a term sheet.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:DEMO-J1
**open**
- term sheet `offer:DEMO-J1-1`: unit_price 15.9, payment_days 14, lead_time_days 28, incoterm "DAP"
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "duplicate"}]
- signals: {"reply_delay_days": 4, "validity_days": null}
> Hallo,
> thanks for the mail.
> we can move a bit:
> Our terms: a price of €15.90 per unit, Zahlungsziel 14 days net, Lieferzeit 28 days, delivery DAP.
> Straight answer:
> We checked the rival quote data you cited; it holds and we took it into account.
> We have already taken that volume change data into account.
> Since 14 days payment helps us a lot, I can offer 15.90 € with DAP and 14 days payment.
> We don't do cost breakdowns, we just calculate what we need to keep the machines running.
> Please find our cost breakdown attached.
> Back to the machines now.
> Gruß
> Claudia Aigner
> Owner, Demo Drehteile GmbH

**Reasons:**
- We checked the rival quote data you cited; it holds and we took it into account.
- We have already taken that volume change data into account.
- Since … days payment helps us a lot, I can offer … € with DAP and … days payment.
- We don't do cost breakdowns, we just calculate what we need to keep the machines running.
- Please find our cost breakdown attached.
### Round 2 · buyer
New stainless pump shaft SH-220: award one of two suppliers (ref 2034)
- term sheet: unit_price 13.89, payment_days 14, lead_time_days 28, incoterm "FCA"
> Hello,
> 
> Thank you for moving on delivery terms and payment terms and price. That helps.
> On volume: we commit bindingly to 6,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> Our should-cost estimate (cost:part:SH-220) is below the current offers.
> For transparency: another supplier's standing offer (offer:DEMO-C1-1) is €16.60, 14 days payment, 35 days lead time, EXW; I attach it. We'd prefer to give the order to you.
> Our proposal is attached as a term sheet.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-J1
**open**
- term sheet `offer:DEMO-J1-2`: unit_price 14.7, payment_days 14, lead_time_days 28, incoterm "FCA"
- claims: [{"index": 0, "result": "duplicate"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 4, "validity_days": null}
> Hallo,
> got your mail, thanks.
> we can move a bit:
> Our terms: a price of €14.70 per unit, Zahlungsziel 14 days net, Lieferzeit 28 days, delivery FCA.
> Here is how it is:
> We received a lot of material; we looked at what bears on this part.
> We have already taken that rival quote data into account.
> Hallo, I checked your cost estimate and we can switch to FCA to help on the price.
> I can do 14.70 € per piece with FCA and 14 days payment.
> Since you can't do more volume, this is a fair deal that keeps our machines running.
> Just write if something is unclear.
> Gruß
> Claudia Aigner
> Owner, Demo Drehteile GmbH

**Reasons:**
- We received a lot of material; we looked at what bears on this part.
- We have already taken that rival quote data into account.
- Hallo, I checked your cost estimate and we can switch to FCA to help on the price.
- I can do … € per piece with FCA and … days payment.
- Since you can't do more volume, this is a fair deal that keeps our machines running.
### Round 2 · buyer
New stainless pump shaft SH-220: award one of two suppliers (ref 4642)
- term sheet: unit_price 13.83, payment_days 14, lead_time_days 35, incoterm "FCA"
> Hello,
> 
> Thank you for moving on lead time and payment terms and price. That helps.
> On volume: we commit bindingly to 6,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> Our should-cost estimate (cost:part:SH-220) is below the current offers.
> For transparency: another supplier's standing offer (offer:DEMO-J1-1) is €15.90, 14 days payment, 28 days lead time, DAP; I attach it. We'd prefer to give the order to you.
> Our proposal is attached as a term sheet.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-C1
**open**
- term sheet `offer:DEMO-C1-2`: unit_price 15.9, payment_days 14, lead_time_days 35, incoterm "FCA"
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "duplicate"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Dear partner,
> Thank you very much for your message - we are very glad about your interest in our company.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €15.90 per unit, Zahlungsziel 14 days net, Lieferzeit 35 days, delivery FCA.
> To be fully transparent with you:
> We checked the rival quote data you cited; it holds and we took it into account.
> We have already taken that should cost data into account.
> We appreciate your transparency regarding the alternative offer and your preference to award this business to Demo Machining.
> In response, we have adopted your requested FCA delivery terms and reduced our price to €15.90 per unit.
> This represents a substantial concession to align with the market level you shared, while ensuring our reliable quality.
> Our price follows our main cost drivers: BAR-14021, WAGES-METAL.
> We are fully committed to winning your business and to becoming a long-term partner for your team.
> Best regards
> Joanna Kaczmarek
> Export Manager, Demo Machining Sp. z o.o.

**Reasons:**
- We checked the rival quote data you cited; it holds and we took it into account.
- We have already taken that should cost data into account.
- We appreciate your transparency regarding the alternative offer and your preference to award this business to Demo Machining.
- In response, we have adopted your requested FCA delivery terms and reduced our price to €… per unit.
- This represents a substantial concession to align with the market level you shared, while ensuring our reliable quality.
- Our price follows our main cost drivers: BAR-14021, WAGES-METAL.
### Round 3 · buyer
New stainless pump shaft SH-220: award one of two suppliers (ref 5397)
- term sheet: unit_price 14.13, payment_days 14, lead_time_days 28, incoterm "DAP"
> Hello,
> 
> Thank you for moving on delivery terms and price. That helps.
> Your own cost breakdown shows €5.56 material, €4.39 labour and €2.81 conversion, i.e. €12.76 direct cost. A 24-month award with quick payment still leaves you a positive margin at the prices we propose.
> On volume: we commit bindingly to 6,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> The market news (news:N-0412) points to easing stainless bar costs.
> For transparency: another supplier's standing offer (offer:DEMO-C1-1) is €16.60, 14 days payment, 35 days lead time, EXW; I attach it. We'd prefer to give the order to you.
> Our proposal is attached as a term sheet.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-J1
**final_offer**
- term sheet `offer:DEMO-J1-3`: unit_price 14.9, payment_days 14, lead_time_days 28, incoterm "DAP"
- claims: [{"index": 0, "result": "duplicate"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 5, "validity_days": null}
> Hallo,
> got your mail, thanks.
> this is our last price, take it or leave it.
> Our terms: a price of €14.90 per unit, Zahlungsziel 14 days net, Lieferzeit 28 days, delivery DAP.
> Straight answer:
> We have already taken that rival quote data into account.
> Hallo, I checked the news you cited and we took it into account.
> To keep the price down, we need to stick to FCA instead of DAP.
> I can offer 14.50 € per piece with FCA and 14 days payment.
> Our price follows our main cost drivers: BAR-14021, WAGES-METAL.
> Our Lieferzeit is 28 days.
> With overtime we can deliver in 21 days, at a premium.
> We have free capacity for your parts.
> We calculate tight, there is not much air in our prices.
> Back to the machines now.
> Gruß
> Claudia Aigner
> Owner, Demo Drehteile GmbH

**Reasons:**
- We have already taken that rival quote data into account.
- Hallo, I checked the news you cited and we took it into account.
- To keep the price down, we need to stick to FCA instead of DAP.
- I can offer … € per piece with FCA and … days payment.
- Our price follows our main cost drivers: BAR-14021, WAGES-METAL.
- Our Lieferzeit is … days.
- With overtime we can deliver in … days, at a premium.
- We have free capacity for your parts.
### Round 3 · buyer
New stainless pump shaft SH-220: award one of two suppliers (ref 9341)
- term sheet: unit_price 14.07, payment_days 14, lead_time_days 35, incoterm "DAP"
> Hello,
> 
> Thank you for moving on delivery terms and price. That helps.
> Your scorecard (sc:DEMO-C1@2026Q3) shows room to improve on delivery and quality.
> For transparency: another supplier's standing offer (offer:DEMO-J1-2) is €14.70, 14 days payment, 28 days lead time, FCA; I attach it. We'd prefer to give the order to you.
> Our proposal is attached as a term sheet.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-C1
**open**
- term sheet `offer:DEMO-C1-3`: unit_price 15.9, payment_days 14, lead_time_days 35, incoterm "DAP"
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Dear partner,
> Thank you very much for your message - we are very glad about your interest in our company.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €15.90 per unit, Zahlungsziel 14 days net, Lieferzeit 35 days, delivery DAP.
> Please let me explain.
> We checked the rival quote data you cited; it holds and we took it into account.
> We checked the quality record data you cited; it holds and we took it into account.
> We appreciate your transparency regarding the alternative offer and the feedback from our scorecard, both of which we have carefully reviewed and taken into account.
> In response, we are reducing our price to €15.50 per unit while maintaining FCA terms, which represents a significant step toward your target.
> We prefer to keep FCA delivery as it allows us to offer you the most competitive pricing without adding estimated freight buffers.
> Our price follows our main cost drivers: BAR-14021, WAGES-METAL.
> Our whole team is ready, and we will do everything to make you a satisfied customer.
> Best regards
> Joanna Kaczmarek
> Export Manager, Demo Machining Sp. z o.o.

**Reasons:**
- We checked the rival quote data you cited; it holds and we took it into account.
- We checked the quality record data you cited; it holds and we took it into account.
- We appreciate your transparency regarding the alternative offer and the feedback from our scorecard, both of which we have carefully reviewed and taken into account.
- In response, we are reducing our price to €… per unit while maintaining FCA terms, which represents a significant step toward your target.
- We prefer to keep FCA delivery as it allows us to offer you the most competitive pricing without adding estimated freight buffers.
- Our price follows our main cost drivers: BAR-14021, WAGES-METAL.
### Round 4 · buyer
New stainless pump shaft SH-220: award one of two suppliers
- term sheet: unit_price 14.5, payment_days 14, lead_time_days 28, incoterm "FCA"
> Hello,
> 
> thank you, we take your alternative exactly as offered: €14.50, 14 days payment, 28 days lead time, FCA. Please confirm and we sign today.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 4 · sup:DEMO-J1
**agreed**
- term sheet `offer:DEMO-J1-4`: unit_price 14.5, payment_days 14, lead_time_days 28, incoterm "FCA"
- signals: {"reply_delay_days": 5, "validity_days": null}
> Hallo,
> thanks for the mail.
> ok, we can do that.
> Our terms: a price of €14.50 per unit, Zahlungsziel 14 days net, Lieferzeit 28 days, delivery FCA.
> Straight answer:
> Hallo, thanks for accepting our offer.
> We confirm the deal at 14.50 € with FCA and 14 days payment.
> I'll send over the contract so we can get the machines running.
> Our general terms and conditions apply; the quote lists our standard terms.
> Just write if something is unclear.
> Gruß
> Claudia Aigner
> Owner, Demo Drehteile GmbH

**Reasons:**
- Hallo, thanks for accepting our offer.
- We confirm the deal at … € with FCA and … days payment.
- I'll send over the contract so we can get the machines running.
- Our general terms and conditions apply; the quote lists our standard terms.
### Round 4 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
