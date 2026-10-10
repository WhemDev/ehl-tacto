---
case: "case:D01"
session: "bdbfe94b59fb97f7"
set: "sandbox"
score: 0.609
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 3
c_open: 448810.67
c_deal: 424346.67
c_best: 408623.99
agent: "orchestra+sandbox-check2"
commit: "a5da2ba"
tags: ["run"]
---
# D01 · score 0.609

[Replay](https://arena.tacto.ai/replay/bdbfe94b59fb97f7) · deal with sup:DEMO-F1 · accepted

## Result
- terms: payment_days 30, lead_time_days 35, volume_per_year 4000, contract_months 24, effective_date "2026-12-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 650, chargeback_eur_per_complaint 0.0, unit_price 51.5
- C open 448810.67 · C deal 424346.67 · C alt None · C best 408623.99

| item | eur |
|---|---|
| price | 412000.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 2746.67 |
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
- term sheet: unit_price 51.28, payment_days 30, contract_months 24, effective_date "2027-01-01"
- term sheet: unit_price 51.88, payment_days 45, contract_months 24, effective_date "2027-04-01"
- term sheet: unit_price 51.51, payment_days 60, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> Thank you for your letter and the quote.
> Our recent orders (po:4500001201) show we have bought PH-100 steadily at the current price.
> Our should-cost estimate for PH-100 (cost:part:PH-100) sits well below the new price.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-1`: unit_price 51.7, payment_days 30, contract_months 24, effective_date "2027-01-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We checked the should cost data you cited; it holds and we took it into account. We appreciate your prompt response and the options provided, as we highly value our long-standing partnership. While our internal cost structures remain confidential, we have carefully considered your should-cost estimate. Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
> 
> In the spirit of our trustful cooperation, we are pleased to offer €51.70 based on your first package, securing a 24-month contract starting January 2027. For our offer, we propose a price of €51.70 per unit, a Zahlungsziel of 30 days net, a contract term of 24 months, valid from 1 January 2027. Please note that this offer remains valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We appreciate your prompt response and the options provided, as we highly value our long-standing partnership.
- While our internal cost structures remain confidential, we have carefully considered your should-cost estimate.
- In the spirit of our trustful cooperation, we are pleased to offer €… based on your first package, securing a 24-month contract starting January ….
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 2 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 51.42, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 51.87, payment_days 45, contract_months 24, effective_date "2027-02-01"
- term sheet: unit_price 52.39, payment_days 60, contract_months 24, effective_date "2027-04-01"
> Hello,
> 
> Thank you for your letter and the quote.
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> Our latest order (po:4500001342) confirms the steady volume.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-2`: unit_price 51.5, payment_days 30, contract_months 24, effective_date "2026-12-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We checked the delivery record data you cited; it holds, but it does not change our calculation. We value our long-standing partnership and acknowledge the steady volume confirmed by your recent orders. As a family-run foundry, our detailed cost structures remain confidential, but we assure you our pricing reflects current market realities. Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
> 
> In the spirit of our trustful cooperation, we are pleased to offer €51.50 based on your first package, accepting the earlier start date of December 2026. Specifically, our offer provides a price of €51.50 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. This offer is valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We value our long-standing partnership and acknowledge the steady volume confirmed by your recent orders.
- As a family-run foundry, our detailed cost structures remain confidential, but we assure you our pricing reflects current market realities.
- In the spirit of our trustful cooperation, we are pleased to offer €… based on your first package, accepting the earlier start date of December ….
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 2 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
