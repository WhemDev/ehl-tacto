---
case: "case:P07"
session: "ebcd69396abaaa19"
set: "practice"
score: 0.689
deal: true
supplier: "sup:70610"
end_reason: "accepted"
rounds: 5
c_open: 391027.4
c_deal: 327828.8
c_best: 299241.49
agent: "orchestra+noprofiles2"
commit: "3d78de2"
tags: ["run"]
---
# P07 · score 0.689

[Replay](https://arena.tacto.ai/replay/ebcd69396abaaa19) · deal with sup:70610 · accepted

## Result
- terms: payment_days 90, lead_time_days 5, volume_per_year 30000, contract_months 24, effective_date "2027-01-01", index_clause null, incoterm "DAP", tooling_eur 0.0, ppm_commitment 80, chargeback_eur_per_complaint 0.0, unit_price 5.5
- C open 391027.4 · C deal 327828.8 · C alt 379916.0 · C best 299241.49

| item | eur |
|---|---|
| price | 330000.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | -2200.0 |
| freight | 0.0 |
| late_delivery | 0.0 |
| quality | 28.8 |
| tooling | 0.0 |
| index_clause | 0.0 |
| index_risk | 0.0 |
| relationship | 0.0 |

## Negotiation
### Round 0 · sup:70610
**open**
- term sheet `offer:70610-0`: unit_price 5.74, payment_days 30, contract_months 12
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Thank you for your enquiry. Please find our Angebot below.
> Our terms: a price of €5.74 per unit, Zahlungsziel 30 days net, a contract term of 12 months.
> And while we are at it: our whole range is at your disposal, so if there is anything else on your list, just send it over - we are happy to quote.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH
### Round 1 · buyer
Fastener kit bundle – our two proposals
- term sheet: unit_price 5.14, payment_days 90, contract_months 24
- term sheet: unit_price 5.07, payment_days 30, contract_months 24
> Dear Mr Stadler,
> 
> Thank you for your quick offer and the kind words; we value working with Leitner & Sohn and would like to bundle the full fastener kit with you.
> 
> Two points shape our view of the price:
> Your on-time delivery over the last 12 months was 88.6% (sc:70610@2026Q3), below our 95% target.
> Producer prices DE: fasteners and screw machine products changed +1.7% from 2025-08 to 2026-08 (idx:PPI-C2594@2025-08, idx:PPI-C2594@2026-08).
> 
> We have attached two packages, both with a 24-month contract:
> - Package 1: EUR 5.14 per unit with 90-day payment terms.
> - Package 2: EUR 5.07 per unit in exchange for faster payment at 30 days.
> 
> Please let us know which suits you better. Could you also share a cost breakdown for this part?
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 1 · sup:70610
**open**
- term sheet `offer:70610-1`: unit_price 5.6, payment_days 90, contract_months 24
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> Many thanks for your e-mail, and great to hear from you; I went through it right away with our team.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €5.60 per unit, Zahlungsziel 90 days net, a contract term of 24 months.
> Here is the background.
> Your figures confirm our case: that driver rose.
> We checked the delivery record data you cited; it holds, but it does not change our calculation.
> We appreciate your intention to bundle the fastener kit with us and are pleased to build on your second package with a 24-month contract and 30-day payment terms.
> Reflecting the extended contract duration and our commitment to this partnership, we can offer a revised price of €5.53 per unit.
> Alternatively, with Zahlungsziel 30 days net: €5.53 per unit.
> Material accounts for about 61 % of our cost; more detail we do not share.
> We look forward to doing good business together, and our team is always there for you.
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- Your figures confirm our case: that driver rose.
- We checked the delivery record data you cited; it holds, but it does not change our calculation.
- We appreciate your intention to bundle the fastener kit with us and are pleased to build on your second package with a 24-month contract and 30-day payment terms.
- Reflecting the extended contract duration and our commitment to this partnership, we can offer a revised price of €… per unit.
- Alternatively, with Zahlungsziel … days net: €… per unit.
- Material accounts for about … of our cost; more detail we do not share.
### Round 2 · buyer
Fastener kit bundle: our package for your review
- term sheet: unit_price 5.17, payment_days 90, contract_months 24
> Dear Mr Stadler,
> 
> Thank you for your quick and constructive reply, and for confirming the data we cited. We value your willingness to build a 24-month partnership around the fastener kit.
> 
> Labour cost index DE, manufacturing, seasonally and calendar adjusted (quarterly, carried to its three months) changed +2.7% from 2025-06 to 2026-06 (idx:LCI-C@2025-06, idx:LCI-C@2026-06).
> 
> With that in view, we have attached our package. Package 1 offers a price of 5.17 per unit with 90-day payment terms and a 24-month contract. In return for the longer payment term, the full contract length gives you volume certainty over two years.
> 
> Which package works best for you, and what would you need from us to make it work?
> 
> We look forward to your thoughts.
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 2 · sup:70610
**open**
- term sheet `offer:70610-2`: unit_price 5.57, payment_days 90, contract_months 24
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We received a lot of material; we looked at what bears on this part. We have verified the labour cost index data you cited; however, it does not impact our calculation for this specific part.
> 
> Our current Angebot is a price of €5.57 per unit, Zahlungsziel 90 days net, a contract term of 24 months.
> 
> To make this work and offer a more competitive rate, we must request 30-day payment terms. In exchange for 30-day payment terms and a 24-month contract, we can offer a revised price of EUR 5.50 per unit, and we kindly ask you to share the expected volume. As another option, we can offer a price of €5.50 per unit, Zahlungsziel 30 days net, a contract term of 24 months. Which volume can you commit to? A binding higher volume would help us and can improve the price.
> 
> Our general terms and conditions apply; the quote lists our standard terms. Our standard Zahlungsziel is 30 days net. This offer stays valid for 30 days.
> 
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We received a lot of material; we looked at what bears on this part.
- We have verified the labour cost index data you cited; however, it does not impact our calculation for this specific part.
- To make this work and offer a more competitive rate, we must request 30-day payment terms.
- In exchange for 30-day payment terms and a 24-month contract, we can offer a revised price of EUR … per unit, and we kindly ask you to share the expected volume.
- Which volume can you commit to?
- Our general terms and conditions apply; the quote lists our standard terms.
- Our standard Zahlungsziel is … days net.
- A binding higher volume would help us and can improve the price.
### Round 3 · buyer
Fastener kit bundle: our package for closing
- term sheet: unit_price 5.27, payment_days 90, contract_months 24
> Dear Mr Stadler,
> 
> Thank you for your quick reply and for checking the labour cost index data so carefully. We appreciate the movement you have shown over the last rounds.
> 
> We have attached one package to help us close. Package 1 is a price of 5.27 per unit with 90-day payment terms and a 24-month contract. It keeps the term and payment structure you already offered at 90 days. In return we ask you to meet us on price.
> 
> The gap between us is now mainly the unit price. How could we get closer together there? If another combination of payment terms and contract length would help you reach a better price, we are happy to look at it.
> 
> We would like to finish this in a fair and straightforward way and look forward to your answer.
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 3 · sup:70610
**open**
- term sheet `offer:70610-3`: unit_price 5.53, payment_days 90, contract_months 24
- signals: {"reply_delay_days": 1, "validity_days": 30}
> Dear customer,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We appreciate your willingness to explore other combinations of terms to reach an agreement. 
> 
> Our current Angebot stands at a price of €5.53 per unit, Zahlungsziel 90 days net, a contract term of 24 months. 
> 
> By adjusting the payment terms to our standard 30 days net, we can offer a reduced price of €5.46 per unit. As an alternative, this package provides a price of €5.46 per unit, Zahlungsziel 30 days net, a contract term of 24 months. 
> 
> To help us close the remaining gap, we kindly ask you to share the expected volume. Which volume can you commit to? A binding higher volume would help us and can improve the price. 
> 
> Please note that this offer remains valid for 30 days.
> 
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We appreciate your willingness to explore other combinations of terms to reach an agreement.
- By adjusting the payment terms to our standard … days net, we can offer a reduced price of €… per unit.
- To help us close the remaining gap, we kindly ask you to share the expected volume.
- Which volume can you commit to?
- A binding higher volume would help us and can improve the price.
### Round 4 · buyer
Fastener kit bundle: our updated package
- term sheet: unit_price 5.38, payment_days 90, contract_months 24
> Dear Mr Stadler,
> 
> Thank you for your revised offer and for the flexibility you have shown on payment terms and contract length. We appreciate the constructive way you are working with us.
> 
> We have attached one package for your review: a price of €5.38 per unit with payment at 90 days and a 24-month contract. This keeps the longer payment term and the full two-year commitment you have already offered, and in return asks for movement on the unit price. We think this is a fair way to meet in the middle.
> 
> How do you think we could close the remaining gap on price? We would welcome your ideas.
> 
> We look forward to wrapping this up together soon.
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 4 · sup:70610
**final_offer**
- term sheet `offer:70610-4`: unit_price 5.5, payment_days 90, contract_months 24
- signals: {"reply_delay_days": 2, "validity_days": 7}
> Dear customer,
> 
> Thank you for reaching out to us. We appreciate your revised offer and your constructive approach to finding a middle ground. As your dedicated distributor, we are always eager to support your operations with our extensive inventory and reliable service.
> 
> We can adjust our price to €5.50 per unit for a 24-month contract with 90-day payment terms. Please note that this is our final offer (letztes Angebot). Please decide. To help us close the remaining gap, please let us know what volume you can commit to. Which volume can you commit to? For your information, our price follows our main cost drivers: PPI-C2594, LCI-C.
> 
> Regarding our current Angebot: it presents a price of €5.50 per unit, Zahlungsziel 90 days net, a contract term of 24 months.
> 
> Please be aware that this offer stays valid for 7 days.
> 
> Mit freundlichen Grüßen
> Franz Stadler
> Inside Sales, Schraubenhandel Leitner & Sohn GmbH

**Reasons:**
- We appreciate your revised offer and your constructive approach to finding a middle ground.
- We can adjust our price to €… per unit for a 24-month contract with 90-day payment terms.
- To help us close the remaining gap, please let us know what volume you can commit to.
- Which volume can you commit to?
- Our price follows our main cost drivers: PPI-C2594, LCI-C.
### Round 4 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
