---
case: "case:D01"
session: "2cfffa931f6a7fe1"
set: "sandbox"
score: 0.787
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 3
c_open: 448810.67
c_deal: 417185.82
c_best: 408623.99
agent: "orchestra+sandbox-check2"
commit: "a5da2ba"
tags: ["run"]
---
# D01 · score 0.787

[Replay](https://arena.tacto.ai/replay/2cfffa931f6a7fe1) · deal with sup:DEMO-F1 · accepted

## Result
- terms: payment_days 30, lead_time_days 35, volume_per_year 4000, contract_months 24, effective_date "2027-01-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 650, chargeback_eur_per_complaint 0.0, unit_price 50.7
- C open 448810.67 · C deal 417185.82 · C alt None · C best 408623.99

| item | eur |
|---|---|
| price | 404886.58 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 2699.24 |
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
> 
> Thank you for your enquiry. Please find our Angebot below. 
> 
> As a family-run foundry, we deeply value our long relationship and take great pride in the dedication of our skilled team. In light of current market conditions, WAGES-METAL rose 3.1 % in twelve months and is 28 % of our cost. 
> 
> We are pleased to submit our offer at a price of €52.90 per unit, with a Zahlungsziel 30 days net, a contract term of 12 months, valid from 1 December 2026. Please note that this offer remains valid for 30 days.
> 
> We look forward to continuing our trustful cooperation and working together with you.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- WAGES-METAL rose … in twelve months and is … of our cost.
### Round 1 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.9, payment_days 30, contract_months 24, effective_date "2027-04-01"
- term sheet: unit_price 49.85, payment_days 45, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 50.15, payment_days 60, contract_months 24, effective_date "2027-02-01"
> Hello,
> 
> Thank you for your letter and the quote. Energy and wage costs have clearly been a strain for a foundry this year, and after many years together we want you healthy and on our side.
> Our recent orders (po:4500001201) show we have bought PH-100 steadily at the current price.
> Our should-cost estimate for PH-100 (cost:part:PH-100) sits well below the new price.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
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
> 
> We have reviewed your offer and can adjust our Angebot as follows. We checked the should cost data you cited; it holds and we took it into account. We greatly appreciate your recognition of the current challenges in the foundry sector and deeply value our long-standing partnership. 
> 
> Our adjusted offer stands at a price of €51.30 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 April 2027. Alternatively, with valid from 1 January 2027: €51.00 per unit, Zahlungsziel 30 days net, a contract term of 24 months.
> 
> Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us. Our colleagues will address your request regarding the cost breakdown separately. Please note that this offer remains valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We greatly appreciate your recognition of the current challenges in the foundry sector and deeply value our long-standing partnership.
- Our colleagues will address your request regarding the cost breakdown separately.
- Alternatively, with valid from … January …: €… per unit.
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 2 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 50.44, payment_days 30, contract_months 24, effective_date "2027-01-01"
- term sheet: unit_price 50.53, payment_days 45, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 50.89, payment_days 60, contract_months 24, effective_date "2027-02-01"
> Hello,
> 
> Thank you for moving on contract length and price and the start date. That helps.
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> Our latest order (po:4500001342) confirms the steady volume.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-2`: unit_price 50.7, payment_days 30, contract_months 24, effective_date "2027-01-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We checked the delivery record data you cited; it holds, but it does not change our calculation. However, we acknowledge your latest scorecard and the steady volume shown in your recent orders. 
> 
> Our family foundry values our long standing relationship, and we always strive to work together openly. To answer your question, we would need a commitment to higher volume to move closer to your numbers. Which volume can you commit to?
> 
> We can adjust our offer to €50.70 per unit for a contract starting 1 January 2027 with 30-day payment terms. In detail, our Angebot stands at a price of €50.70 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 January 2027. Please note that this offer remains valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We acknowledge your latest scorecard and the steady volume shown in your recent orders.
- To answer your question, we would need a commitment to higher volume to move closer to your numbers.
- We can adjust our offer to €… per unit for a contract starting … January … with 30-day payment terms.
- Which volume can you commit to?
### Round 2 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
