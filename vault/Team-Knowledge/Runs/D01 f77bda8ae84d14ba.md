---
case: "case:D01"
session: "f77bda8ae84d14ba"
set: "sandbox"
score: 0.806
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 4
c_open: 448810.67
c_deal: 416414.68
c_best: 408623.99
agent: "another teammate"
tags: ["run"]
---
# D01 · score 0.806

[Replay](https://arena.tacto.ai/replay/f77bda8ae84d14ba) · deal with sup:DEMO-F1 · accepted

## Result
- terms: payment_days 30, lead_time_days 35, volume_per_year 4000, contract_months 24, effective_date "2027-01-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 650, chargeback_eur_per_complaint 0.0, unit_price 50.6
- C open 448810.67 · C deal 416414.68 · C alt None · C best 408623.99

| item | eur |
|---|---|
| price | 404120.55 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 2694.14 |
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
- term sheet: unit_price 47.72, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 47.55, payment_days 30, contract_months 24, effective_date "2027-04-01"
> Hello,
> 
> Thank you for your letter and the quote.
> Our recent orders (po:4500001201) show we have bought PH-100 steadily at the current price.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-1`: unit_price 51.8, payment_days 30, contract_months 24, effective_date "2027-04-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We appreciate your steady orders and deeply value our long-standing partnership with your esteemed house. 
> 
> Our current Angebot stands at a price of €51.80 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 April 2027. We are agreeable to extending the contract term to 24 months to provide mutual planning security. With this longer commitment, we are pleased to revise our offer to €51.30 per unit. Alternatively, we can offer a price of €51.30 per unit, Zahlungsziel 30 days net, a contract term of 24 months, with valid from 1 December 2026. 
> 
> Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us. Please note that this offer remains valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We appreciate your steady orders and deeply value our long-standing partnership.
- We are agreeable to extending the contract term to … months to provide mutual planning security.
- With this longer commitment, we are pleased to revise our offer to €… per unit.
- Alternatively, with valid from … December …: €… per unit.
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 2 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 50.2, payment_days 30, contract_months 24, effective_date "2027-04-01"
- term sheet: unit_price 50.0, payment_days 30, contract_months 24, effective_date "2027-01-01"
> Hello,
> 
> Thank you for your letter and the quote.
> Our should-cost estimate for PH-100 (cost:part:PH-100) sits well below the new price.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-2`: unit_price 50.6, payment_days 30, contract_months 24, effective_date "2027-01-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We checked the should cost data you cited; it holds and we took it into account. We note your should-cost estimate, but our pricing reflects the realities of our production and the high quality you expect from our foundry. 
> 
> For our long-standing partnership, we are pleased to offer €50.60 per unit for a 24-month contract starting 1 January 2027. Under this Angebot, we propose a price of €50.60 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 January 2027. Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
> 
> Please note that this Angebot remains valid for 30 days. We look forward to continuing our trusted work together.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We note your should-cost estimate, but our pricing reflects the realities of our production and the high quality you expect from our foundry.
- We are pleased to offer €… per unit for a 24-month contract starting … January ….
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 3 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.44, payment_days 30, contract_months 24, effective_date "2027-01-01"
- term sheet: unit_price 49.48, payment_days 30, contract_months 24, effective_date "2027-02-01"
> Hello,
> 
> Thank you for your letter and the quote.
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-3`: unit_price 50.6, payment_days 30, contract_months 24, effective_date "2027-01-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> It is always a pleasure to deal with our valued partners at Hollerau Pumpenwerke GmbH, a relationship our foundry has cherished over many years. We have reviewed your latest proposal and note the reference to our scorecard, which underscores our reliable delivery performance. Furthermore, we checked the delivery record data you cited; it holds, but it does not change our calculation. 
> 
> We have reviewed your offer and hold our Angebot. We therefore maintain our offer of €50.60 per unit and reiterate that our internal cost calculations remain confidential. Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
> 
> For clarity, our current offer remains a price of €50.60 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 January 2027. Please note that this offer stays valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We have reviewed your latest proposal and note the reference to our scorecard, which underscores our reliable delivery performance.
- We therefore maintain our offer of €… per unit and reiterate that our internal cost calculations remain confidential.
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 3 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
