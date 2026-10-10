---
case: "case:D01"
session: "fbfb12d64cea86fc"
set: "sandbox"
score: 0.849
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 4
c_open: 448810.67
c_deal: 414682.67
c_best: 408623.99
agent: "orchestra+sandbox-check"
commit: "dce12e5"
tags: ["run"]
---
# D01 · score 0.849

[Replay](https://arena.tacto.ai/replay/fbfb12d64cea86fc) · deal with sup:DEMO-F1 · accepted

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
> 
> We have reviewed your offer and can adjust our Angebot as follows. We appreciate your understanding of the current cost pressures and deeply value our long-standing partnership with your company. 
> 
> Our primary Angebot stands at a price of €51.60 per unit, Zahlungsziel 60 days net, a contract term of 24 months, valid from 1 December 2026. We are willing to commit to the 24-month contract and the January 1, 2027 start date you proposed in your first package. In return for this extended commitment, we can reduce our price to €51.40 per unit. Alternatively, with Zahlungsziel 30 days net and valid from 1 January 2027: €51.40 per unit. 
> 
> Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us. Please note that this offer stays valid for 30 days.
> 
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
- term sheet: unit_price 49.73, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 50.02, payment_days 45, contract_months 24, effective_date "2027-02-01"
- term sheet: unit_price 50.13, payment_days 60, contract_months 24, effective_date "2027-01-01"
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
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We checked the should cost data you cited; it holds and we took it into account. Indeed, we have reviewed your should-cost estimate and adjusted our calculation accordingly. Building on your first package, we can offer €50.50 per unit with 30 days payment and a 24-month contract starting December 1, 2026. 
> 
> Our current offer stands at a price of €50.50 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. This offer stays valid for 30 days.
> 
> Our price reflects our costs; our calculation stays internal. However, to move closer to your proposed numbers, we would require a commitment to higher volume. Which volume can you commit to? 
> 
> We value the long relationship between our companies and look forward to finding a good path forward together.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We have reviewed your should-cost estimate and adjusted our calculation accordingly.
- Building on your first package, we can offer €… per unit with … days payment and a 24-month contract starting December … ….
- To move closer to your proposed numbers, we would require a commitment to higher volume.
- Which volume can you commit to?
- Our price reflects our costs; our calculation stays internal.
### Round 3 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.83, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 50.27, payment_days 45, contract_months 24, effective_date "2027-04-01"
- term sheet: unit_price 50.23, payment_days 60, contract_months 24, effective_date "2027-01-01"
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
- term sheet `offer:DEMO-F1-3`: unit_price 50.3, payment_days 30, contract_months 24, effective_date "2026-12-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We checked the delivery record data you cited; it holds, but it does not change our calculation. We have noted your reference to our scorecard, which reflects the reliable delivery performance you have come to expect from us over our long partnership. 
> 
> We appreciate your binding commitment to 4,000 pieces per year, which provides valuable planning security for our foundry. In recognition of your volume commitment, we can reduce our price to €50.30 per unit for your first package. 
> 
> Our current offer stands at a price of €50.30 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. Please note that this offer remains valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We appreciate your binding commitment to … pieces per year, which provides valuable planning security for our foundry.
- We have noted your reference to our scorecard, which reflects the reliable delivery performance you have come to expect from us over our long partnership.
- In recognition of your volume commitment, we can reduce our price to €… per unit for your first package.
### Round 3 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
