---
case: "case:D01"
session: "daa7ba7fa9f055e8"
set: "sandbox"
score: 0.943
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 6
c_open: 448810.67
c_deal: 410932.79
c_best: 408623.99
agent: "another teammate"
tags: ["run"]
---
# D01 · score 0.943

[Replay](https://arena.tacto.ai/replay/daa7ba7fa9f055e8) · deal with sup:DEMO-F1 · accepted

## Result
- terms: payment_days 30, lead_time_days 35, volume_per_year 4000, contract_months 24, effective_date "2026-12-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 650, chargeback_eur_per_complaint 0.0, unit_price 49.8
- C open 448810.67 · C deal 410932.79 · C alt None · C best 408623.99

| item | eur |
|---|---|
| price | 398400.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 2656.0 |
| freight | 9600.0 |
| late_delivery | 0.0 |
| quality | 0.0 |
| tooling | 0.0 |
| index_clause | 0.0 |
| index_risk | 0.0 |
| relationship | 276.79 |

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
- term sheet: unit_price 47.86, payment_days 45, contract_months 24, effective_date "2027-02-01"
- term sheet: unit_price 47.55, payment_days 30, contract_months 24, effective_date "2027-04-01"
> Hello,
> 
> Thank you for your letter and the quote. Energy and wage costs have clearly been a strain for a foundry this year, and after many years together we want you healthy and on our side.
> Our recent orders (po:4500001201) show we have bought PH-100 steadily at the current price.
> Our should-cost estimate for PH-100 (cost:part:PH-100) sits well below the new price.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-1`: unit_price 51.3, payment_days 45, contract_months 24, effective_date "2027-02-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Thank you for your letter - it is always good to hear from you, and I answer it myself, as I do for all the customers we have known for a long time.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €51.30 per unit, Zahlungsziel 45 days net, a contract term of 24 months, valid from 1 February 2027.
> Let me tell you how we see it from our side.
> We checked the should cost data you cited; it holds and we took it into account.
> We appreciate your understanding of the cost pressures we face and deeply value our long-standing partnership.
> We are willing to extend the contract to 24 months as you proposed, provided the new pricing takes effect on 1 January 2027.
> Our colleagues will address your request regarding the cost breakdown, and we have adjusted our price to €51.30 to reflect our commitment to this relationship.
> Alternatively, with Zahlungsziel 30 days net and valid from 1 January 2027: €51.00 per unit.
> Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
> We have worked together for many years, and I am confident that we will find a fair way forward, as we always have between our two houses.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We appreciate your understanding of the cost pressures we face and deeply value our long-standing partnership.
- We are willing to extend the contract to … months as you proposed, provided the new pricing takes effect on … January ….
- Our colleagues will address your request regarding the cost breakdown, and we have adjusted our price to €… to reflect our commitment to this relationship.
- Alternatively, with Zahlungsziel … days net and valid from … January …: €… per unit.
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 2 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 48.82, payment_days 30, contract_months 24, effective_date "2027-01-01"
- term sheet: unit_price 49.01, payment_days 45, contract_months 24, effective_date "2027-02-01"
> Hello,
> 
> Thank you for your reply and for moving on contract length, payment terms, price and the start date. That helps.
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> Our latest order (po:4500001342) confirms the steady volume.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best. Lead time and incoterm are fixed in this enquiry, so the packages are the best place to find common ground.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-2`: unit_price 50.5, payment_days 30, contract_months 24, effective_date "2027-01-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Many thanks for your message; I have read it carefully together with my people here at the foundry, and we have given it the attention it deserves.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €50.50 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 January 2027.
> Let me tell you how we see it from our side.
> Thank you for your continued movement; we have reviewed the scorecard you cited, and our delivery record remains strong.
> To answer your question, a commitment to higher volume would help us get closer to your numbers.
> In response to your movement, we can offer €50.50 for the package with 30 days payment and a start date of 1 January 2027.
> Which volume can you commit to?
> A binding higher volume would help us and can improve the price.
> We have worked together for many years, and I am confident that we will find a fair way forward, as we always have between our two houses.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- Thank you for your continued movement; we have reviewed the scorecard you cited, and our delivery record remains strong.
- To answer your question, a commitment to higher volume would help us get closer to your numbers.
- In response to your movement, we can offer €… for the package with … days payment and a start date of … January ….
- Which volume can you commit to?
- A binding higher volume would help us and can improve the price.
### Round 3 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.34, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 49.68, payment_days 45, contract_months 24, effective_date "2027-04-01"
> Hello,
> 
> Thank you for moving on payment terms and price and the start date. That helps.
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-3`: unit_price 49.9, payment_days 30, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Thank you for your letter - it is always good to hear from you, and I answer it myself, as I do for all the customers we have known for a long time.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €49.90 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026.
> A few words from the foundry on this.
> Thank you for confirming the binding volume of 4,000 pieces a year for 24 months; this gives us the planning security we need.
> In return for this commitment and the earlier start date of 1 December 2026, I am pleased to offer a price of €49.90.
> This is a substantial step from our side to close the remaining gap today, reflecting the value we place on our long-standing partnership.
> Which figures is that based on? Please send us the data.
> We have worked together for many years, and I am confident that we will find a fair way forward, as we always have between our two houses.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- Thank you for confirming the binding volume of … pieces a year for … months; this gives us the planning security we need.
- In return for this commitment and the earlier start date of … December … I am pleased to offer a price of €….
- This is a substantial step from our side to close the remaining gap today, reflecting the value we place on our long-standing partnership.
- Which figures is that based on? Please send us the data.
### Round 4 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.65, payment_days 30, contract_months 24, effective_date "2027-04-01"
- term sheet: unit_price 49.64, payment_days 45, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> Thank you for moving on price and the start date. That helps.
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> You asked which figures our offer is based on. Those details are not something we share in this enquiry, but the packages show clearly where we stand.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 4 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-4`: unit_price 50.1, payment_days 30, contract_months 24, effective_date "2027-04-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Thank you for your letter - it is always good to hear from you, and I answer it myself, as I do for all the customers we have known for a long time.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €50.10 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 April 2027.
> A few words from the foundry on this.
> I note that you are unable to share the data behind your calculations.
> Since your new packages either delay the start date or extend payment terms, I prefer to maintain our previous terms of 30 days payment and a start date of 1 December 2026.
> To help close the remaining gap today, I can offer a further reduction to €49.80 per unit for this package.
> Alternatively, with valid from 1 December 2026: €49.80 per unit.
> Please give my regards to your colleagues - a good relationship has always mattered more to us than a single order, and I hope it stays that way.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- I note that you are unable to share the data behind your calculations.
- Since your new packages either delay the start date or extend payment terms, I prefer to maintain our previous terms of … days payment and a start date of … December ….
- To help close the remaining gap today, I can offer a further reduction to €… per unit for this package.
- Alternatively, with valid from … December …: €… per unit.
### Round 5 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.8, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> thank you, we take your alternative exactly as offered: €49.80, 30 days payment, 24 months, from 2026-12-01. Please confirm and we sign today.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 5 · sup:DEMO-F1
**agreed**
- term sheet `offer:DEMO-F1-5`: unit_price 49.8, payment_days 30, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> Thank you for accepting our alternative offer. As a traditional family business, we deeply value our long relationship, and we are pleased to confirm the agreement at a price of €49.80 per unit with Zahlungsziel 30 days net, a contract term of 24 months, starting 1 December 2026. This Angebot remains valid for 30 days. We can accept your terms and await your order. We look forward to continuing our successful partnership for the years to come.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- Thank you for accepting our alternative offer.
- We are pleased to confirm the agreement at €… per unit with … days payment, a 24-month contract, starting … December ….
- We look forward to continuing our successful partnership for the years to come.
### Round 5 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
