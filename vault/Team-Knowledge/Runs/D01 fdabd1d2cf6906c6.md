---
case: "case:D01"
session: "fdabd1d2cf6906c6"
set: "sandbox"
score: 0.849
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 4
c_open: 448810.67
c_deal: 414682.67
c_best: 408623.99
agent: "another teammate"
tags: ["run"]
---
# D01 · score 0.849

[Replay](https://arena.tacto.ai/replay/fdabd1d2cf6906c6) · deal with sup:DEMO-F1 · accepted

## Result
- terms: payment_days 30, lead_time_days 35, volume_per_year 4000, contract_months 24, effective_date "2026-12-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 650, chargeback_eur_per_complaint 0.0, unit_price 50.3
- C open 448810.67 · C deal 414682.67 · C alt None · C best 408623.99

| item | eur |
|---|---|
| price | 402400.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 2682.67 |
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
- term sheet: unit_price 47.86, payment_days 45, contract_months 24, effective_date "2027-02-01"
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
- term sheet `offer:DEMO-F1-1`: unit_price 51.7, payment_days 45, contract_months 24, effective_date "2027-02-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We highly value our long-standing relationship and your steady orders over the years, which have meant a great deal to our foundry.
> 
> Our current Angebot is a price of €51.70 per unit, Zahlungsziel 45 days net, a contract term of 24 months, valid from 1 February 2027. This offer remains valid for 30 days.
> 
> While we cannot share a detailed internal cost breakdown, our colleagues will provide further context on the market drivers affecting our industry. Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
> 
> We are willing to accept the 24-month contract and the delayed effective date of April 2027 from your second package, and in return, we can lower our price to €51.80. Alternatively, with Zahlungsziel 30 days net and valid from 1 April 2027: €51.80 per unit. As another option: a price of €51.80 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 April 2027.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We highly value our long-standing relationship and your steady orders over the years.
- While we cannot share a detailed internal cost breakdown, our colleagues will provide further context on the market drivers affecting our industry.
- We are willing to accept the 24-month contract and the delayed effective date of April … from your second package, and in return, we can lower our price to €….
- Alternatively, with Zahlungsziel … days net and valid from … April …: €… per unit.
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
### Round 2 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.03, payment_days 30, contract_months 24, effective_date "2027-02-01"
- term sheet: unit_price 49.16, payment_days 45, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> Our should-cost estimate for PH-100 (cost:part:PH-100) sits well below the new price.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-2`: unit_price 50.7, payment_days 30, contract_months 24, effective_date "2027-02-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> Our family foundry values the long relationship we share, and we have checked the should cost data you cited; it holds and we took it into account. We have reviewed your should-cost estimate, but our pricing must reflect the actual operational realities of our foundry. Our price reflects our costs; our calculation stays internal. 
> 
> In response to your movement, we can offer a revised price of €50.70 per unit. We are pleased to build on your first package by accepting the 30-day payment terms and the February 2027 effective date. Thus, our offer stands at a price of €50.70 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 February 2027. 
> 
> Please note that this offer stays valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We have reviewed your should-cost estimate, but our pricing must reflect the actual operational realities of our foundry.
- We are pleased to build on your first package by accepting the 30-day payment terms and the February … effective date.
- In response to your movement, we can offer a revised price of €… per unit.
- Our price reflects our costs; our calculation stays internal.
### Round 3 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.41, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 49.62, payment_days 45, contract_months 24, effective_date "2027-01-01"
> Hello,
> 
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-3`: unit_price 50.3, payment_days 30, contract_months 24, effective_date "2026-12-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We checked the delivery record data you cited; it holds, but it does not change our calculation. We have reviewed the scorecard you referenced; our reliable delivery performance is a cornerstone of our long-standing partnership. 
> 
> We are willing to build on your first package by accepting the December 2026 effective date. In response to your movement and this adjustment, we can lower our price to €50.30 per unit. 
> 
> Our offer is a price of €50.30 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. This Angebot remains valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We have reviewed the scorecard you referenced; our reliable delivery performance is a cornerstone of our long-standing partnership.
- We are willing to build on your first package by accepting the December … effective date.
- In response to your movement and this adjustment, we can lower our price to €… per unit.
### Round 3 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
