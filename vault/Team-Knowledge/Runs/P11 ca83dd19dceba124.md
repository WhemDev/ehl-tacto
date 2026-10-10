---
case: "case:P11"
session: "ca83dd19dceba124"
set: "practice"
score: 0.626
deal: true
supplier: "sup:70140"
end_reason: "accepted"
rounds: 5
c_open: 817578.0
c_deal: 758032.5
c_best: 722500.02
agent: "orchestra+profiles2"
commit: "3d78de2"
tags: ["run"]
---
# P11 · score 0.626

[Replay](https://arena.tacto.ai/replay/ca83dd19dceba124) · deal with sup:70140 · accepted

## Result
- terms: payment_days 60, lead_time_days 56, volume_per_year 15900, contract_months 12, effective_date "2027-01-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 300, chargeback_eur_per_complaint 0.0, unit_price 46.0
- C open 817578.0 · C deal 758032.5 · C alt 894383.19 · C best 722500.02

| item | eur |
|---|---|
| price | 731400.0 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 0.0 |
| freight | 24486.0 |
| late_delivery | 0.0 |
| quality | 2146.5 |
| tooling | 0.0 |
| index_clause | 0.0 |
| index_risk | 0.0 |
| relationship | 0.0 |

## Negotiation
### Round 0 · sup:70140
**open**
- term sheet `offer:70140-0`: unit_price 47.0, ppm_commitment 6400
- signals: {"reply_delay_days": 4, "validity_days": 30}
> Hello,
> 
> Thank you for your enquiry. Please find our Angebot below. We are very excited about the opportunity to work together with Hollerau Pumpenwerke GmbH and to prove ourselves as a reliable partner for your business!
> 
> For our offer, we can propose a price of €47.00 per unit, alongside a quality commitment of 6400 ppm. 
> 
> Please note that this offer stays valid for 30 days. We are eager to show you what we can do and hope this initial quote meets your expectations. Let us know if you have any questions at all.
> 
> Kind regards
> Marek Lis
> Export Manager, Odlewnia Kalwisz Sp. z o.o.
### Round 1 · buyer
Bearing bracket: our proposal on quality and price (2 packages attached)
- term sheet: ppm_commitment 300, chargeback_eur_per_complaint 500, unit_price 43.76
- term sheet: ppm_commitment 300, chargeback_eur_per_complaint 0.0, unit_price 43.62
> Dear Mr Lis,
> 
> Thank you for your offer and your wish to prove yourselves as a reliable partner. We value working with you and want to build on it.
> 
> On the bearing bracket, quality comes first for us. A commitment of 6400 ppm is too high, so both attached packages set the defect rate at 300 ppm. Package 1: 43.76 EUR with a chargeback of 500 EUR per complaint. Package 2: a lower 43.62 EUR in exchange for no chargeback.
> 
> Producer prices DE: electric power generation, transmission and distribution changed -3.7% from 2025-08 to 2026-08 (idx:PPI-D351@2025-08, idx:PPI-D351@2026-08).
> Your on-time delivery over the last 12 months was 63.5% (sc:70140@2026Q3), below our 95% target.
> 
> Please share your 8D corrective actions and a cost breakdown for this part. Better performance is the basis for a stable partnership and reliable payment.
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 1 · sup:70140
**open**
- term sheet `offer:70140-1`: unit_price 46.5, ppm_commitment 300, chargeback_eur_per_complaint 0.0
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 4, "validity_days": 30}
> Hello,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We checked the index change data you cited; it holds and we took it into account. We also checked the delivery record data you cited; it holds and we took it into account. 
> 
> We see your figures, but we cannot give up margin right now. Faster payment would help us more than anything. We looked at your second package and can agree to the 300 ppm with zero chargebacks, but we need €46.50 per unit to cover the extra sorting. We are stepping up on quality for you, but we really need you to pay your invoices on time, as the recent delays are causing us issues. Material accounts for about 30 % of our cost; more detail we do not share.
> 
> Our current offer is a price of €46.50 per unit, a quality commitment of 300 ppm, a chargeback of €0.00 per complaint. This offer stays valid for 30 days.
> 
> Kind regards
> Marek Lis
> Export Manager, Odlewnia Kalwisz Sp. z o.o.

**Reasons:**
- We checked the index change data you cited; it holds and we took it into account.
- We checked the delivery record data you cited; it holds and we took it into account.
- We see your figures, but we cannot give up margin right now. Faster payment would help us more than anything.
- We looked at your second package and can agree to the … ppm with zero chargebacks, but we need €… per unit to cover the extra sorting.
- We are stepping up on quality for you, but we really need you to pay your invoices on time, as the recent delays are causing us issues.
- Material accounts for about … of our cost; more detail we do not share.
### Round 2 · buyer
Bearing brackets: 300 ppm packages and 8D actions
- term sheet: ppm_commitment 300, chargeback_eur_per_complaint 500, unit_price 43.94
- term sheet: ppm_commitment 300, chargeback_eur_per_complaint 0.0, unit_price 43.8
> Dear Mr Lis,
> 
> Thank you for your quick reply, for confirming 300 ppm with zero chargebacks, and for sending the 8D report. We value the step up on quality.
> 
> We cannot move to €46.50 per unit. Producer prices DE: basic iron and steel, ferro-alloys changed +6.5% from 2025-08 to 2026-08 (idx:PPI-C241@2025-08, idx:PPI-C241@2026-08).
> 
> Both attached packages hold 300 ppm. Package 1 is €43.94 per unit with a €500 chargeback per complaint. Package 2 is €43.80 per unit with no chargeback.
> 
> We hear you on paying on time. We would like strong quality and delivery performance to build a path toward reliable payment and a secure, long-term partnership.
> 
> Please share the specific 8D corrective actions for the bearing bracket, with owners and completion dates. Which package suits you best, and what would you need to make it work?
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 2 · sup:70140
**open**
- term sheet `offer:70140-2`: unit_price 46.5, ppm_commitment 300, chargeback_eur_per_complaint 0.0
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 4, "validity_days": 30}
> Hello,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> We looked at the steel index data you sent; it's correct and we took it into account. As to the index change data you cited, we see your figures, but we cannot give up margin right now. Faster payment would help us more than anything.
> 
> The package with 300 ppm and zero chargebacks suits us best, but we are sticking to our offer of €46.50 for it. So, our offer stands at a price of €46.50 per unit, a quality commitment of 300 ppm, a chargeback of €0.00 per complaint. Please note that this offer stays valid for 30 days.
> 
> We really hope this works for you and look forward to building a great partnership together!
> 
> Kind regards
> Marek Lis
> Export Manager, Odlewnia Kalwisz Sp. z o.o.

**Reasons:**
- As to the index change data you cited, we see your figures, but we cannot give up margin right now. Faster payment would help us more than anything.
- We looked at the steel index data you sent; it's correct and we took it into account.
- The package with … ppm and zero chargebacks suits us best, but we are sticking to our offer of €… for it.
### Round 3 · buyer
Bearing brackets: two packages and the 8D actions
- term sheet: ppm_commitment 300, chargeback_eur_per_complaint 500, unit_price 44.44
- term sheet: ppm_commitment 300, chargeback_eur_per_complaint 0.0, unit_price 44.31
> Dear Mr Lis,
> 
> Thank you for your revised offer and for sending the 8D report. We appreciate your movement on the ppm commitment and chargebacks.
> 
> Quality remains our first priority for the bearing bracket. Please share the concrete 8D containment and corrective actions, with owners and completion dates.
> 
> We have attached two packages, both at 300 ppm. Package 1 keeps a chargeback of EUR 500 per complaint, at EUR 44.44 per unit. Package 2 drops chargebacks entirely, at EUR 44.31 per unit.
> 
> Labour cost index DE, manufacturing, seasonally and calendar adjusted (quarterly, carried to its three months) changed +2.7% from 2025-06 to 2026-06 (idx:LCI-C@2025-06, idx:LCI-C@2026-06).
> 
> We understand that margin matters to you. We want a stable partnership in which strong quality and delivery build trust on both sides. How could we close the remaining gap on price?
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 3 · sup:70140
**open**
- term sheet `offer:70140-3`: unit_price 46.0, ppm_commitment 300, chargeback_eur_per_complaint 0.0
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 4, "validity_days": 30}
> Hello,
> 
> We received a lot of material; we looked at what bears on this part. We have reviewed your offer and can adjust our Angebot as follows.
> 
> We checked the labour cost index data you sent; it holds and we took it into account. As to the index change data you cited, we see your figures, but we cannot give up margin right now. Faster payment would help us more than anything. Our price follows our main cost drivers: LCI-C, PPI-C241, PPI-D351. Our standard Zahlungsziel is 60 days net. Faster payment is welcome; we can reflect it in the price. To close the gap further, we really need you to pay your invoices on time, as the recent delays are causing us issues.
> 
> We can come down to €46.00 for the package with zero chargebacks. Our current Angebot is a price of €46.00 per unit, a quality commitment of 300 ppm, a chargeback of €0.00 per complaint. This offer is valid for 30 days.
> 
> Kind regards
> Marek Lis
> Export Manager, Odlewnia Kalwisz Sp. z o.o.

**Reasons:**
- We received a lot of material; we looked at what bears on this part.
- As to the index change data you cited, we see your figures, but we cannot give up margin right now. Faster payment would help us more than anything.
- We checked the labour cost index data you sent; it holds and we took it into account.
- We can come down to €… for the package with zero chargebacks.
- To close the gap further, we really need you to pay your invoices on time, as the recent delays are causing us issues.
- Our price follows our main cost drivers: LCI-C, PPI-C241, PPI-D351.
- Our standard Zahlungsziel is … days net.
- Faster payment is welcome; we can reflect it in the price.
### Round 4 · buyer
Bearing brackets: two packages to close the gap
- term sheet: ppm_commitment 300, chargeback_eur_per_complaint 500, unit_price 45.04
- term sheet: ppm_commitment 300, chargeback_eur_per_complaint 0.0, unit_price 44.91
> Dear Mr Lis,
> 
> Thank you for your revised offer and for sending the 8D report. We appreciate the movement on the ppm commitment and on chargebacks.
> 
> Quality comes first for us on this part. Current performance is 2376 ppm and 63.5 % on-time delivery against a 95 % target. Please share the specific 8D corrective actions, owners and completion dates so we can follow them together.
> 
> We have heard your point on on-time payment and take it seriously.
> 
> We attach two packages, both at a 300 ppm commitment:
> - Package 1: €45.04 per unit, with a €500 chargeback per complaint.
> - Package 2: €44.91 per unit, with no chargeback.
> 
> We have moved towards you. How do you see us closing the remaining distance on price?
> 
> Kind regards,
> Purchasing, Hollerau Pumpenwerke
### Round 4 · sup:70140
**open**
- term sheet `offer:70140-4`: unit_price 46.0, ppm_commitment 300, chargeback_eur_per_complaint 0.0
- signals: {"reply_delay_days": 4, "validity_days": 30}
> Hello,
> 
> We have reviewed your offer and can adjust our Angebot as follows. Our current Angebot is a price of €46.00 per unit, a quality commitment of 300 ppm, a chargeback of €0.00 per complaint. 
> 
> Thanks for the new numbers, but we cannot drop below €46.00 for the zero chargeback package, especially with the recent payment delays. Which figures is that based on? Please send us the data. 
> 
> Please note that our price follows our main cost drivers: LCI-C, PPI-C241, PPI-D351. We hope this aligns well with your expectations for our cooperation. This offer stays valid for 30 days.
> 
> Kind regards
> Marek Lis
> Export Manager, Odlewnia Kalwisz Sp. z o.o.

**Reasons:**
- Thanks for the new numbers, but we cannot drop below €… for the zero chargeback package, especially with the recent payment delays.
- Which figures is that based on? Please send us the data.
- Our price follows our main cost drivers: LCI-C, PPI-C241, PPI-D351.
### Round 4 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
