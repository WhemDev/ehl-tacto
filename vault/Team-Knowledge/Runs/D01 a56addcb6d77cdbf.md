---
case: "case:D01"
session: "a56addcb6d77cdbf"
set: "sandbox"
score: 0.823
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 5
c_open: 448810.67
c_deal: 415730.7
c_best: 408623.99
agent: "orchestra+sandbox-check"
commit: "dce12e5"
tags: ["run"]
---
# D01 · score 0.823

[Replay](https://arena.tacto.ai/replay/a56addcb6d77cdbf) · deal with sup:DEMO-F1 · accepted

## Result
- terms: payment_days 30, lead_time_days 35, volume_per_year 4000, contract_months 24, effective_date "2027-02-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 650, chargeback_eur_per_complaint 0.0, unit_price 50.6
- C open 448810.67 · C deal 415730.7 · C alt None · C best 408623.99

| item | eur |
|---|---|
| price | 403441.1 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 2689.61 |
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
- term sheet: unit_price 49.9, payment_days 30, contract_months 24, effective_date "2027-01-01"
- term sheet: unit_price 50.01, payment_days 45, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 50.49, payment_days 60, contract_months 24, effective_date "2027-04-01"
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
- term sheet `offer:DEMO-F1-2`: unit_price 50.6, payment_days 30, contract_months 24, effective_date "2027-01-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We checked the should cost data you cited; it holds and we took it into account. We acknowledge your should-cost estimate, which allows us to adjust our calculation. 
> 
> It is always a pleasure working with your team, and our foundry is pleased to present this updated calculation. We can offer a price of €50.60 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 January 2027. This offer stays valid for 30 days.
> 
> To bridge the remaining gap to your numbers, we would need a commitment to a higher volume. Which volume can you commit to? A binding higher volume would help us and can improve the price. We look forward to continuing our long-standing collaboration.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We acknowledge your should-cost estimate, which allows us to adjust our calculation.
- We can offer €… per unit for the package with … days payment and a 24-month contract starting January … ….
- To bridge the remaining gap to your numbers, we would need a commitment to a higher volume.
- Which volume can you commit to?
- A binding higher volume would help us and can improve the price.
### Round 3 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 50.36, payment_days 30, contract_months 24, effective_date "2027-02-01"
- term sheet: unit_price 50.46, payment_days 45, contract_months 24, effective_date "2027-01-01"
- term sheet: unit_price 50.55, payment_days 60, contract_months 24, effective_date "2026-12-01"
> Hello,
> 
> Thank you for moving on payment terms and price and the start date. That helps.
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you; we cannot honestly promise more.
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-3`: unit_price 50.6, payment_days 30, contract_months 24, effective_date "2027-02-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We deeply value the long relationship between our companies, and we appreciate your binding commitment to 4,000 pieces a year for 24 months, which allows us to make a further concession. We have reviewed the scorecard you referenced, and we are proud of our strong delivery record.
> 
> Our current Angebot stands at a price of €50.60 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 February 2027. This offer stays valid for 30 days.
> 
> As an alternative, in exchange for keeping the start date at January 1, 2027, we can offer €50.50 per unit with 30 days payment, under a price of €50.50 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 January 2027.
> 
> A binding higher volume would help us and can improve the price. Which volume can you commit to?
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We appreciate your binding commitment to … pieces a year for … months, which allows us to make a further concession.
- We have reviewed the scorecard you referenced, and we are proud of our strong delivery record.
- In exchange for keeping the start date at January … … we can offer €… per unit with … days payment.
- A binding higher volume would help us and can improve the price.
- Which volume can you commit to?
### Round 4 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 49.74, payment_days 30, contract_months 24, effective_date "2027-01-01"
> Hello,
> 
> thank you, we are very close and I would like to close this with you today. On exactly your terms, can you do €49.74? If yes, we sign immediately.
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 4 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-4`: unit_price 50.6, payment_days 30, contract_months 24, effective_date "2027-02-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We appreciate your desire to conclude this agreement today and deeply value our long-standing partnership. Our family-run foundry takes great pride in the quality of the work our people deliver to you, and we always look back warmly on our shared history in the region. 
> 
> We have reviewed your offer and hold our Angebot. Our proposal remains set at a price of €50.60 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 February 2027. Please note that our offer stays valid for 30 days.
> 
> We trust that this proposal reflects our continued commitment to your company, and we look forward to maintaining our strong business relationship for many years to come.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We appreciate your desire to conclude this agreement today and deeply value our long-standing partnership.
### Round 4 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
