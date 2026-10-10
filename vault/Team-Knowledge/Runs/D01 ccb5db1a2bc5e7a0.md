---
case: "case:D01"
session: "ccb5db1a2bc5e7a0"
set: "sandbox"
score: 0.869
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 7
c_open: 448810.67
c_deal: 413877.33
c_best: 408623.99
agent: "orchestra+sandbox-check"
commit: "dce12e5"
tags: ["run"]
---
# D01 · score 0.869

[Replay](https://arena.tacto.ai/replay/ccb5db1a2bc5e7a0) · deal with sup:DEMO-F1 · accepted

## Result
- terms: payment_days 30, lead_time_days 35, volume_per_year 4000, contract_months 24, effective_date "2026-12-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 650, chargeback_eur_per_complaint 0.0, unit_price 50.2
- C open 448810.67 · C deal 413877.33 · C alt None · C best 408623.99

| item | eur |
|---|---|
| price | 401600.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 2677.33 |
| freight | 9600.0 |
| late_delivery | 0.0 |
| quality | 0.0 |
| tooling | 0.0 |
| index_clause | 0.0 |
| index_risk | 0.0 |
| relationship | 0.0 |

## Negotiation
### Round 0 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-0`: unit_price 52.9, payment_days 30, contract_months 12, effective_date "2026-12-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Thank you for your enquiry. Please find our Angebot below.
> Our terms: a price of €52.90 per unit, Zahlungsziel 30 days net, a contract term of 12 months, valid from 1 December 2026.
> A few words from the foundry on this.
> WAGES-METAL rose 3.1 % in twelve months and is 28 % of our cost.
> Please give my regards to your colleagues - a good relationship has always mattered more to us than a single order, and I hope it stays that way.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- WAGES-METAL rose … in twelve months and is … of our cost.
### Round 1 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 47.7, payment_days 30, contract_months 24, effective_date "2027-01-01"
- term sheet: unit_price 47.86, payment_days 45, contract_months 24, effective_date "2027-02-01"
- term sheet: unit_price 48.12, payment_days 60, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> Thank you for your letter and the quote. Energy and wage costs have clearly been a strain for a foundry this year, and after many years together we want you healthy and on our side.
> Our recent orders (po:4500001201) show we have bought PH-100 steadily at the current price.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-1`: unit_price 51.6, payment_days 60, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Many thanks for your message; I have read it carefully together with my people here at the foundry, and we have given it the attention it deserves.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €51.60 per unit, Zahlungsziel 60 days net, a contract term of 24 months, valid from 1 December 2026.
> A few words from the foundry on this.
> We appreciate your understanding of the current cost pressures and deeply value our long-standing partnership.
> We are willing to commit to the 24-month contract and the January 1, 2027 start date you proposed in your first package.
> In return for this extended commitment, we can reduce our price to €51.40 per unit.
> Alternatively, with Zahlungsziel 30 days net and valid from 1 January 2027: €51.40 per unit.
> Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
> Please give my regards to your colleagues - a good relationship has always mattered more to us than a single order, and I hope it stays that way.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We appreciate your understanding of the current cost pressures and deeply value our long-standing partnership.
- We are willing to commit to the 24-month contract and the January … … start date you proposed in your first package.
- In return for this extended commitment, we can reduce our price to €… per unit.
- Alternatively, with Zahlungsziel … days net and valid from … January …: €… per unit.
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 2 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 48.97, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 49.18, payment_days 45, contract_months 24, effective_date "2027-02-01"
- term sheet: unit_price 49.43, payment_days 60, contract_months 24, effective_date "2027-04-01"
> Hello,
> 
> Thank you for moving on contract length and payment terms and price. That helps.
> Our should-cost estimate for PH-100 (cost:part:PH-100) sits well below the new price.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-2`: unit_price 50.5, payment_days 30, contract_months 24, effective_date "2026-12-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Many thanks for your message; I have read it carefully together with my people here at the foundry, and we have given it the attention it deserves.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €50.50 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026.
> A few words from the foundry on this.
> We checked the should cost data you cited; it holds and we took it into account.
> We have noted your should-cost estimate, but our pricing must reflect the actual operational realities of our foundry.
> Building on your first package with 30-day payment terms and a 24-month contract starting December 2026, we can reduce our price to €50.50 per unit.
> To move closer to your proposed numbers, we would require a commitment to higher order volumes.
> Which volume can you commit to?
> Our price reflects our costs; our calculation stays internal.
> Please give my regards to your colleagues - a good relationship has always mattered more to us than a single order, and I hope it stays that way.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We have noted your should-cost estimate, but our pricing must reflect the actual operational realities of our foundry.
- Building on your first package with 30-day payment terms and a 24-month contract starting December … we can reduce our price to €… per unit.
- To move closer to your proposed numbers, we would require a commitment to higher order volumes.
- Which volume can you commit to?
- Our price reflects our costs; our calculation stays internal.
### Round 3 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.5, payment_days 30, contract_months 24, effective_date "2027-04-01"
- term sheet: unit_price 49.56, payment_days 45, contract_months 24, effective_date "2027-01-01"
- term sheet: unit_price 49.68, payment_days 60, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> Thank you for moving on payment terms and price. That helps.
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-3`: unit_price 50.6, payment_days 30, contract_months 24, effective_date "2027-04-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Many thanks for your message; I have read it carefully together with my people here at the foundry, and we have given it the attention it deserves.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €50.60 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 April 2027.
> Let me tell you how we see it from our side.
> We checked the delivery record data you cited; it holds, but it does not change our calculation.
> We appreciate your binding commitment to 4,000 pieces a year for the 24-month term, which provides valuable planning security.
> We have also noted your reference to our scorecard, which reflects the reliable delivery performance our skilled team consistently provides.
> In recognition of your volume commitment, we can reduce our price to €50.20 per unit for a start in December 2026 with 30-day payment terms.
> A binding higher volume would help us and can improve the price.
> Which volume can you commit to?
> Our Lieferzeit is 35 days.
> Please give my regards to your colleagues - a good relationship has always mattered more to us than a single order, and I hope it stays that way.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We appreciate your binding commitment to … pieces a year for the 24-month term, which provides valuable planning security.
- We have also noted your reference to our scorecard, which reflects the reliable delivery performance our skilled team consistently provides.
- In recognition of your volume commitment, we can reduce our price to €… per unit for a start in December … with 30-day payment terms.
- A binding higher volume would help us and can improve the price.
- Which volume can you commit to?
- Our Lieferzeit is … days.
### Round 4 · buyer

### Round 4 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-4`: unit_price 50.6, payment_days 30, contract_months 24, effective_date "2027-04-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Many thanks for your message; I have read it carefully together with my people here at the foundry, and we have given it the attention it deserves.
> We have reviewed your offer and hold our Angebot.
> Our terms: a price of €50.60 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 April 2027.
> Let me tell you how we see it from our side.
> We are following up on our previous message, as we have not yet received your reply.
> Our offer of €50.60 per unit remains valid for the April 2027 start date.
> Please let us know your decision so we can secure the necessary capacity for your order.
> We have supplied you reliably for years and expect fairness in return.
> Please give my regards to your colleagues - a good relationship has always mattered more to us than a single order, and I hope it stays that way.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We are following up on our previous message, as we have not yet received your reply.
- Our offer of €… per unit remains valid for the April … start date.
- Please let us know your decision so we can secure the necessary capacity for your order.
### Round 5 · buyer

### Round 5 · sup:DEMO-F1
**final_offer**
- term sheet `offer:DEMO-F1-5`: unit_price 50.6, payment_days 30, contract_months 24, effective_date "2027-04-01"
- signals: {"reply_delay_days": 3, "validity_days": 7}
> Guten Tag,
> Thank you for your letter - it is always good to hear from you, and I answer it myself, as I do for all the customers we have known for a long time.
> This is our final offer (letztes Angebot). Please decide.
> Our terms: a price of €50.60 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 April 2027.
> A few words from the foundry on this.
> We have not yet received a response to our previous message.
> Our offer of €50.60 per unit remains on the table.
> Perhaps a brief meeting would help us align and conclude this agreement.
> We have supplied you reliably for years and expect fairness in return.
> Please give my regards to your colleagues - a good relationship has always mattered more to us than a single order, and I hope it stays that way.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We have not yet received a response to our previous message.
- Our offer of €… per unit remains on the table.
- Perhaps a brief meeting would help us align and conclude this agreement.
### Round 6 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 50.2, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> thank you. We take your alternative exactly as offered: unit_price 50.2, payment_days 30, contract_months 24, effective_date 2026-12-01. Please confirm and we sign today.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 6 · sup:DEMO-F1
**agreed**
- term sheet `offer:DEMO-F1-6`: unit_price 50.2, payment_days 30, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 3, "validity_days": 14}
> Guten Tag,
> 
> We are pleased to confirm the agreement on the terms you accepted. We can accept your terms and await your order. This concludes our negotiation and secures our continued partnership. 
> 
> For the record, our offer stands at a price of €50.20 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. This offer stays valid for 14 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We are pleased to confirm the agreement on the terms you accepted.
- This concludes our negotiation and secures our continued partnership.
### Round 6 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
