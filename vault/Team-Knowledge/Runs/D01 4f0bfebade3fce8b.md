---
case: "case:D01"
session: "4f0bfebade3fce8b"
set: "sandbox"
score: 0.829
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 7
c_open: 448810.67
c_deal: 415488.0
c_best: 408623.99
agent: "orchestra+engine2"
commit: "78774e4"
tags: ["run"]
---
# D01 · score 0.829

[Replay](https://arena.tacto.ai/replay/4f0bfebade3fce8b) · deal with sup:DEMO-F1 · accepted

## Result
- terms: payment_days 30, lead_time_days 35, volume_per_year 4000, contract_months 24, effective_date "2026-12-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 650, chargeback_eur_per_complaint 0.0, unit_price 50.4
- C open 448810.67 · C deal 415488.0 · C alt None · C best 408623.99

| item | eur |
|---|---|
| price | 403200.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 2688.0 |
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
PH-100 pump housing: our proposal and two packages
- term sheet: unit_price 48.63, payment_days 60, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 48.31, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Dear Mr. Moser,
> 
> Thank you for your offer and for the open way you explained your situation. We value our long relationship with your foundry.
> 
> Our should-cost estimate (cost:part:PH-100) sits below the current offer. Your latest scorecard (sc:DEMO-F1@2026Q2) is part of how we review the partnership.
> 
> We have attached two packages of equal value to us, each with a 24-month contract and the new price from 2026-12-01:
> - Package 1: price 48.63, payment in 60 days.
> - Package 2: price 48.31, payment in 30 days.
> 
> So a longer payment term comes with a slightly higher price, and faster payment with a lower one. Lead time (35 days) and Incoterm FCA are fixed in this enquiry, so the packages focus on price, payment and contract length.
> 
> Could you also send us your cost breakdown, so we can see which costs really moved? And which of the two packages suits you better, and why?
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 1 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-1`: unit_price 50.9, payment_days 30, contract_months 24, effective_date "2026-12-01"
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We checked the delivery record data you cited; it holds, but it does not change our calculation. Furthermore, we checked the should cost data you cited; it holds and we took it into account. We appreciate your constructive approach and your recognition of our long-standing partnership. 
> 
> We prefer your second package with the 30-day payment term, as it supports our operational stability, and we are willing to commit to a 24-month contract. While our company policy does not permit sharing detailed internal cost breakdowns, we have reviewed your should-cost estimate and can offer a revised price of €50.90. 
> 
> Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us. Our price reflects our costs; our calculation stays internal. 
> 
> Our current Angebot stands at a price of €50.90 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. This offer stays valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We checked the should cost data you cited; it holds and we took it into account.
- We appreciate your constructive approach and your recognition of our long-standing partnership.
- We prefer your second package with the 30-day payment term, as it supports our operational stability, and we are willing to commit to a 24-month contract.
- While our company policy does not permit sharing detailed internal cost breakdowns, we have reviewed your should-cost estimate and can offer a revised price of €….
- Our costs move with SCRAP-E3, WAGES-METAL, GAS-TTF; the figures stay with us.
- Our price reflects our costs; our calculation stays internal.
### Round 2 · buyer
PH-100: two packages for your review
- term sheet: unit_price 48.68, payment_days 60, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 48.36, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Dear Mr Moser,
> 
> Thank you for your reply and for your openness. Thank you for moving on price and contract length. That helps.
> 
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you.
> 
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> 
> We have attached two packages of equal value to us. Package 1 offers 48.68 with a 60-day payment term, while Package 2 offers 48.36 with a 30-day payment term. Both run 24 months, with the new price from 2026-12-01. Lead time and Incoterm are fixed in this enquiry, so the packages focus on price and payment instead.
> 
> What would you need from us to get closer to these numbers?
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 2 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-2`: unit_price 50.8, payment_days 30, contract_months 24, effective_date "2026-12-01"
- claims: [{"index": 0, "result": "duplicate"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We value your long-standing trust in our foundry and our region's craftsmanship. We prefer your second package with the 30-day payment term and can offer a revised price of €50.80 per unit, with a Zahlungsziel of 30 days net, a contract term of 24 months, valid from 1 December 2026. This offer stays valid for 30 days.
> 
> We have already taken that delivery record data into account, and the scorecard data you referenced was already taken into account in our previous calculation. We value your binding commitment to 4,000 pieces per year, but we ask you to provide the volume data to substantiate this. Which volume can you commit to? A binding higher volume would help us and can improve the price.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We have already taken that delivery record data into account.
- We value your binding commitment to … pieces per year, but we ask you to provide the volume data to substantiate this.
- The scorecard data you referenced was already taken into account in our previous calculation.
- We prefer your second package with the 30-day payment term and can offer a revised price of €….
- Which volume can you commit to?
- A binding higher volume would help us and can improve the price.
### Round 3 · buyer
PH-100: our two packages and next steps
- term sheet: unit_price 48.82, payment_days 60, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 48.5, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Dear Mr. Moser,
> 
> Thank you for your reply and for your continued trust in us. We value the partnership.
> 
> Thank you for moving on price. That helps.
> 
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you.
> 
> Our recent orders (po:4500001201) show we have bought this part steadily at the current price.
> 
> The two attached packages are equal in value to us and differ in what they trade. Package 1 is 48.82 with 60 days payment, while Package 2 is 48.50 with 30 days payment. Both run 24 months from 2026-12-01. Lead time and Incoterm FCA are fixed in this enquiry.
> 
> How could we close the remaining gap today? Which of the two trades matters most to you?
> 
> Best regards,
> Purchasing, Hollerau Pumpenwerke
### Round 3 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-3`: unit_price 50.7, payment_days 30, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> Our family foundry values the long relationship we share with your company, and we have reviewed your recent orders and appreciate your binding commitment to 4,000 pieces per year. In response to your movement, we are pleased to offer a revised price of €50.70 per unit. We prefer the 30-day payment term for our operational stability and have focused on your second package. Please note that our standard Zahlungsziel is 30 days net. 
> 
> A binding higher volume would help us and can improve the price. Which volume can you commit to? 
> 
> Our current offer stands at a price of €50.70 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. This offer is valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We have reviewed your recent orders and appreciate your binding commitment to … pieces per year.
- We prefer the 30-day payment term for our operational stability and have focused on your second package.
- In response to your movement, we are pleased to offer a revised price of €….
- A binding higher volume would help us and can improve the price.
- Which volume can you commit to?
- Our standard Zahlungsziel is … days net.
### Round 4 · buyer
PH-100 pump housing: our two packages
- term sheet: unit_price 49.03, payment_days 60, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 48.71, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Dear Mr Moser,
> 
> Thank you for your reply and for the care your foundry puts into this relationship.
> 
> Thank you for moving on price. That helps.
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you.
> Our recent orders (po:4500001288) show we have bought this part steadily at the current price.
> 
> That volume is fixed at 4,000 pieces, so we can't raise it. The attached packages show what we can offer instead. Package 1 is 49.03 with 60-day payment, and Package 2 is 48.71 with 30-day payment. Both run 24 months with the new price from 2026-12-01. Lead time of 35 days and Incoterm FCA are fixed in this enquiry.
> 
> How could we close the remaining gap today? Which of the two trades suits you better?
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 4 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-4`: unit_price 50.6, payment_days 30, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We appreciate your movement on price and your clarification that the volume is fixed at 4,000 pieces per year. 
> 
> As a long-standing partner in our region, we value the trust between our companies over many years. We prefer your second package with the 30-day payment term and can offer a revised price of €50.60 per unit. 
> 
> For our business together, our current offer stands at a price of €50.60 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. Please note that this offer remains valid for 30 days.
> 
> We look forward to continuing our successful cooperation and standing by your side with the tradition and quality of our foundry work.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We appreciate your movement on price and your clarification that the volume is fixed at … pieces per year.
- We prefer your second package with the 30-day payment term and can offer a revised price of €… per unit.
### Round 5 · buyer
PH-100: two packages for your consideration
- term sheet: unit_price 49.32, payment_days 60, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 49.0, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Dear Mr Moser,
> 
> Thank you for your reply and for the care you put into it.
> 
> Thank you for moving on price. That helps.
> 
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you.
> 
> Our recent orders (po:4500001342) show we have bought this part steadily at the current price.
> 
> Attached are two packages of equal value to us, each with a 24-month contract and the new price from 2026-12-01:
> - Package 1: 49.32 per piece with a 60-day payment term, so a lower price in exchange for a longer term.
> - Package 2: 49.00 per piece with a 30-day payment term, so faster payment for a lower price.
> 
> Lead time and Incoterm are fixed in this enquiry, so the packages are where we can offer movement.
> 
> How could we close the remaining gap today? We would be glad to meet you on one of these two.
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 5 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-5`: unit_price 50.5, payment_days 30, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We appreciate your continued movement on price and your commitment to our long-standing partnership with our foundry. We prefer your second package with the 30-day payment term, as it supports our operational stability. 
> 
> In response to your offer, we can revise our price to €50.50 per unit. Our current offer stands at a price of €50.50 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. This Angebot is valid for 30 days.
> 
> We are happy to discuss this in a call; until then our offer stands.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We appreciate your continued movement on price and your commitment to our long-standing partnership.
- We prefer your second package with the 30-day payment term, as it supports our operational stability.
- In response to your offer, we can revise our price to €… per unit.
- We are happy to discuss this in a call; until then our offer stands.
### Round 6 · buyer
PH-100: two packages to close the remaining gap
- term sheet: unit_price 49.69, payment_days 60, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 49.36, payment_days 30, contract_months 24, effective_date "2026-12-01"
> Dear Mr Moser,
> 
> Thank you for your open reply and for your continued partnership. We noted your preference for the 30-day payment term.
> 
> Thank you for moving on price. That helps.
> 
> On volume: we commit bindingly to 4,000 pieces a year for 24 months. That is our entire need for this part, all of it with you.
> 
> We have attached two packages of equal value to us, each with a new price from 2026-12-01 and a 24-month contract:
> - Package 1: price 49.69 with payment in 60 days.
> - Package 2: price 49.36 with payment in 30 days.
> 
> The lower price in Package 2 reflects the faster payment you prefer. Lead time of 35 days and Incoterm FCA are fixed in this enquiry, so the packages are where we can offer movement.
> 
> How could we close the remaining gap today? Would you be able to meet us at one of these two packages?
> 
> Best regards,
> Purchasing, Hollerau Pumpenwerke
### Round 6 · sup:DEMO-F1
**final_offer**
- term sheet `offer:DEMO-F1-6`: unit_price 50.4, payment_days 30, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 3, "validity_days": 7}
> Guten Tag,
> 
> We appreciate your continued movement on price and your commitment to our long-standing partnership. The tradition of cooperation between our companies has always meant a great deal to us here in the foundry. 
> 
> We prefer your second package with the 30-day payment term, as it supports our operational stability. In response to your offer, we can revise our price to €50.40 per unit. 
> 
> Please consider this our Angebot. Our proposal includes a price of €50.40 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. 
> 
> This is our final offer (letztes Angebot). Please decide. Please note that this proposal remains valid for 7 days. We hope to continue our shared path together.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We appreciate your continued movement on price and your commitment to our long-standing partnership.
- We prefer your second package with the 30-day payment term, as it supports our operational stability.
- In response to your offer, we can revise our price to €… per unit.
### Round 6 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
