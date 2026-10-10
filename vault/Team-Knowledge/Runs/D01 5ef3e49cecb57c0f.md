---
case: "case:D01"
session: "5ef3e49cecb57c0f"
set: "sandbox"
score: 0.943
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 5
c_open: 448810.67
c_deal: 410932.79
c_best: 408623.99
agent: "another teammate"
tags: ["run"]
---
# D01 · score 0.943

[Replay](https://arena.tacto.ai/replay/5ef3e49cecb57c0f) · deal with sup:DEMO-F1 · accepted

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
- term sheet: unit_price 47.72, payment_days 30, contract_months 24, effective_date "2026-12-01"
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
- term sheet `offer:DEMO-F1-1`: unit_price 51.3, payment_days 30, contract_months 24, effective_date "2027-04-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Many thanks for your message; I have read it carefully together with my people here at the foundry, and we have given it the attention it deserves.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €51.30 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 April 2027.
> Let me tell you how we see it from our side.
> We checked the should cost data you cited; it holds and we took it into account.
> We appreciate your understanding of the current cost pressures and deeply value our long-standing partnership.
> To provide you with planning security, we are willing to accept the 24-month contract term from your first package.
> In exchange for this longer commitment, we can reduce our price to €50.90 per unit, and our team will follow up regarding the cost breakdown.
> Alternatively, with valid from 1 December 2026: €50.90 per unit.
> Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
> We have worked together for many years, and I am confident that we will find a fair way forward, as we always have between our two houses.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We appreciate your understanding of the current cost pressures and deeply value our long-standing partnership.
- To provide you with planning security, we are willing to accept the 24-month contract term from your first package.
- In exchange for this longer commitment, we can reduce our price to €… per unit, and our team will follow up regarding the cost breakdown.
- Alternatively, with valid from … December …: €… per unit.
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 2 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 48.82, payment_days 30, contract_months 24, effective_date "2027-04-01"
- term sheet: unit_price 48.79, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> Thank you for moving on contract length and price and the start date. That helps.
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> Our latest order (po:4500001342) confirms the steady volume.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-2`: unit_price 50.2, payment_days 30, contract_months 24, effective_date "2026-12-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Many thanks for your message; I have read it carefully together with my people here at the foundry, and we have given it the attention it deserves.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €50.20 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026.
> A few words from the foundry on this.
> We checked the delivery record data you cited; it holds, but it does not change our calculation.
> We appreciate your recognition of our reliable delivery performance and the steady volume shown in your recent orders.
> Without such a commitment, we can reduce our price to €50.20 per unit for the 24-month contract starting 1 December 2026.
> Which volume can you commit to?
> We have worked together for many years, and I am confident that we will find a fair way forward, as we always have between our two houses.
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We appreciate your recognition of our reliable delivery performance and the steady volume shown in your recent orders.
- Without such a commitment, we can reduce our price to €… per unit for the 24-month contract starting … December ….
- Which volume can you commit to?
### Round 3 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.18, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 49.21, payment_days 30, contract_months 24, effective_date "2027-01-01"
> Hello,
> 
> Thank you for moving on price and the start date. That helps.
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-3`: unit_price 49.9, payment_days 30, contract_months 24, effective_date "2027-01-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> For our current offer, we propose a price of €49.90 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 January 2027. This offer stays valid for 30 days.
> 
> Alternatively, with valid from 1 December 2026: a price of €49.80 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. 
> 
> We appreciate your clear and binding commitment to 4,000 pieces a year for the next 24 months. In return for this volume security, we are prepared to take a significant step and reduce our price to €49.80 per unit. This brings us very close to closing the gap today, as you requested. Which figures is that based on? Please send us the data.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We appreciate your clear and binding commitment to … pieces a year for the next … months.
- In return for this volume security, we are prepared to take a significant step and reduce our price to €… per unit.
- This brings us very close to closing the gap today, as you requested.
- Alternatively, with valid from … December …: €… per unit.
- Which figures is that based on? Please send us the data.
### Round 4 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.8, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> thank you, we take your alternative exactly as offered: €49.80, 30 days payment, 24 months, from 2026-12-01. Please confirm and we sign today.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 4 · sup:DEMO-F1
**agreed**
- term sheet `offer:DEMO-F1-4`: unit_price 49.8, payment_days 30, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We are pleased to confirm the agreement on these terms. We can accept your terms and await your order. Ourangebot stands at a price of €49.80 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. This offer remains valid for 30 days.
> 
> Thank you for the constructive negotiation and your continued trust in our foundry.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We are pleased to confirm the agreement on these terms.
- Thank you for the constructive negotiation and your continued trust in our foundry.
### Round 4 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
