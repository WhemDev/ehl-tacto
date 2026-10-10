---
case: "case:P01"
session: "2ceb8eeb75ad831f"
set: "practice"
score: 0.93
deal: true
supplier: "sup:70110"
end_reason: "accepted"
rounds: 4
c_open: 1153779.74
c_deal: 1100778.13
c_best: 1096815.78
agent: "hybrid+style-1936-g0-0"
commit: "2ed641c"
tags: ["run"]
---
# P01 · score 0.93

[Replay](https://arena.tacto.ai/replay/2ceb8eeb75ad831f) · deal with sup:70110 · accepted

## Result
- terms: payment_days 14, lead_time_days 42, volume_per_year 8150, contract_months 12, effective_date "2027-04-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 900, chargeback_eur_per_complaint 0.0, unit_price 134.1
- C open 1153779.74 · C deal 1100778.13 · C alt 1176178.02 · C best 1096815.78

| item | eur |
|---|---|
| price | 1067391.66 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 10911.11 |
| freight | 15485.0 |
| late_delivery | 0.0 |
| quality | 1584.36 |
| tooling | 0.0 |
| index_clause | 0.0 |
| index_risk | 0.0 |
| relationship | 5406.0 |

## Negotiation
### Round 0 · sup:70110
**open**
- term sheet `offer:70110-0`: unit_price 138.55, effective_date "2026-11-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Thank you for your enquiry. Please find our Angebot below.
> Our terms: a price of €138.55 per unit, valid from 1 November 2026.
> A few words from the foundry on this.
> LCI-C rose 2.7 % in twelve months and is 30 % of our cost.
> PPI-C241 rose 6.5 % in twelve months and is 24 % of our cost.
> We have worked together for many years, and I am confident that we will find a fair way forward, as we always have between our two houses.
> Viele Grüße aus der Gießerei
> Thomas Brandlhuber
> Owner, Gießerei Brandlhuber GmbH & Co. KG

**Reasons:**
- LCI-C rose … in twelve months and is … of our cost.
- PPI-C241 rose … in twelve months and is … of our cost.
### Round 1 · buyer
Brandlhuber announces +9.5 % on HN volute casings
- term sheet: unit_price 138.55, effective_date "2027-04-01", payment_days 90
> Hello,
> 
> Thank you for your letter and the quote. We also appreciate how clearly you explained the cost drivers behind your offer. Energy and wage costs have clearly been a strain for a foundry this year, and after many years together we want you healthy and on our side.
> Your letter doc:20260911-70110-P01 gives 51 days' notice, while our contract ctr:4600070110 requires 90 days, so a new price cannot start before then.
> Our bottom-up should-cost estimate for this part is €132.64 (cost:310010).
> Our proposal is attached as a term sheet.
> Could you also send us your cost breakdown, so we can see which costs really moved?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 1 · sup:70110
**open**
- term sheet `offer:70110-1`: unit_price 140.7, payment_days 90, effective_date "2027-04-01"
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Many thanks for your message; I have read it carefully together with my people here at the foundry, and we have given it the attention it deserves.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €140.70 per unit, Zahlungsziel 90 days net, valid from 1 April 2027.
> Let me tell you how we see it from our side.
> We checked the should cost data you cited; it holds and we took it into account.
> We checked the notice period data you cited; it holds and we took it into account.
> We did not know that - a fair point.
> We acknowledge the 90-day notice period in our contract and agree to delay the effective date to 1 April 2027.
> In exchange for this significant delay, we must maintain our standard 30-day payment terms.
> As a family-owned foundry, we do not disclose internal cost breakdowns, but we value our long-standing partnership and have reduced our price to €137.50.
> Alternatively, with Zahlungsziel 30 days net: €137.50 per unit.
> Our costs move with LCI-C, PPI-C241, PPI-D351; the figures stay with us.
> Our general terms and conditions apply; the quote lists our standard terms.
> Please give my regards to your colleagues - a good relationship has always mattered more to us than a single order, and I hope it stays that way.
> Viele Grüße aus der Gießerei
> Thomas Brandlhuber
> Owner, Gießerei Brandlhuber GmbH & Co. KG

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We checked the notice period data you cited; it holds and we took it into account.
- We did not know that - a fair point.
- We acknowledge the 90-day notice period in our contract and agree to delay the effective date to … April ….
- In exchange for this significant delay, we must maintain our standard 30-day payment terms.
- As a family-owned foundry, we do not disclose internal cost breakdowns, but we value our long-standing partnership and have reduced our price to €….
- Alternatively, with Zahlungsziel … days net: €… per unit.
- Our costs move with LCI-C, PPI-C241, PPI-D351; the figures stay with us.
- Our general terms and conditions apply; the quote lists our standard terms.
### Round 2 · buyer
Brandlhuber announces +9.5 % on HN volute casings
- term sheet: unit_price 131.42, effective_date "2026-11-01", payment_days 14
- term sheet: unit_price 133.1, effective_date "2027-01-01", payment_days 30
> Hello,
> 
> Thank you for moving on payment terms and price and the start date. That helps. We value our long cooperation and are glad to continue it.
> Thank you also for checking our data and for agreeing to the later effective date. We appreciate your openness.
> Producer prices DE: electric power generation, transmission and distribution changed -3.7% from 2025-08 to 2026-08 (idx:PPI-D351@2025-08, idx:PPI-D351@2026-08).
> Our recent orders po:4500014428-10, po:4500014358-10, po:4500014313-10 show the price level we have been paying.
> We put together 2 packages; each works equally well for us, so pick the one that suits you best. Lead time, volume, contract length, incoterm and tooling are fixed in this enquiry, so the packages keep them as they are.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:70110
**open**
- term sheet `offer:70110-2`: unit_price 134.1, payment_days 30, effective_date "2027-01-01"
- claims: [{"index": 0, "result": "verified"}, {"index": 1, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> Thank you for your letter - it is always good to hear from you, and I answer it myself, as I do for all the customers we have known for a long time.
> We have reviewed your offer and can adjust our Angebot as follows.
> Our terms: a price of €134.10 per unit, Zahlungsziel 30 days net, valid from 1 January 2027.
> Let me tell you how we see it from our side.
> We checked the index change data you cited; it holds and we took it into account.
> We checked the price history data you cited; it holds, but it does not change our calculation.
> We did not know that - a fair point.
> LCI-C rose 2.7 % in twelve months and is 30 % of our cost. That remains.
> PPI-C241 rose 6.5 % in twelve months and is 24 % of our cost. That remains.
> While we acknowledge the price level of your recent orders, our current production realities require a sustainable adjustment from historical levels.
> Building on your second package, we can agree to an effective date of 1 January 2027 with 30-day payment terms at a price of €134.10 per unit.
> Our price reflects our costs; our calculation stays internal.
> Please give my regards to your colleagues - a good relationship has always mattered more to us than a single order, and I hope it stays that way.
> Viele Grüße aus der Gießerei
> Thomas Brandlhuber
> Owner, Gießerei Brandlhuber GmbH & Co. KG

**Reasons:**
- We checked the index change data you cited; it holds and we took it into account.
- We checked the price history data you cited; it holds, but it does not change our calculation.
- We did not know that - a fair point.
- LCI-C rose … in twelve months and is … of our cost. That remains.
- PPI-C241 rose … in twelve months and is … of our cost. That remains.
- While we acknowledge the price level of your recent orders, our current production realities require a sustainable adjustment from historical levels.
- Building on your second package, we can agree to an effective date of … January … with 30-day payment terms at a price of €… per unit.
- Our price reflects our costs; our calculation stays internal.
### Round 3 · buyer
Brandlhuber announces +9.5 % on HN volute casings
- term sheet: unit_price 134.1, effective_date "2027-04-01", payment_days 14
> Hello,
> 
> Thank you for moving on payment terms and price and the start date. That helps. We value our long cooperation with you and are glad to continue it.
> Thank you also for checking the data we cited and for your open reply.
> Your scorecard sc:70110@2026Q3 shows 85.2% on-time delivery.
> In your last 3 renewals of this part we settled on average 3.0 points below your initial ask.
> Our proposal is attached as a term sheet. We hope the packages there give you a good way forward.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:70110
**agreed**
- term sheet `offer:70110-3`: unit_price 134.1, payment_days 14, effective_date "2027-04-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> As to the delivery record data you cited, we did not know that - a fair point. We checked the delivery scorecard data you cited; it holds and we took it into account. Building on your package, we accept the effective date of 1 April 2027 and 14-day payment terms.
> 
> We can accept your terms and await your order. Ourangebot stands at a price of €134.10 per unit, Zahlungsziel 14 days net, valid from 1 April 2027. This offer remains valid for 30 days.
> 
> Viele Grüße aus der Gießerei
> Thomas Brandlhuber
> Owner, Gießerei Brandlhuber GmbH & Co. KG

**Reasons:**
- As to the delivery record data you cited, we did not know that - a fair point.
- We checked the delivery scorecard data you cited; it holds and we took it into account.
- Building on your package, we accept the effective date of … April … and 14-day payment terms.
### Round 3 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
