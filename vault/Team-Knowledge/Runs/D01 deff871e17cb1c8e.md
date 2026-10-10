---
case: "case:D01"
session: "deff871e17cb1c8e"
set: "sandbox"
score: 0.845
deal: true
supplier: "sup:DEMO-F1"
end_reason: "accepted"
rounds: 6
c_open: 448810.67
c_deal: 414872.42
c_best: 408623.99
agent: "orchestra"
commit: "e06dbc7"
tags: ["run"]
---
# D01 · score 0.845

[Replay](https://arena.tacto.ai/replay/deff871e17cb1c8e) · deal with sup:DEMO-F1 · accepted

## Result
- terms: payment_days 30, lead_time_days 35, volume_per_year 4000, contract_months 24, effective_date "2027-01-01", index_clause null, incoterm "FCA", tooling_eur 0.0, ppm_commitment 650, chargeback_eur_per_complaint 0.0, unit_price 50.4
- C open 448810.67 · C deal 414872.42 · C alt None · C best 408623.99

| item | eur |
|---|---|
| price | 402588.49 |
| uncovered_need | 0.0 |
| fallback_risk | 0.0 |
| payment_terms | 2683.92 |
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
- term sheet: unit_price 47.75, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 47.86, payment_days 45, contract_months 24, effective_date "2027-02-01"
- term sheet: unit_price 48.1, payment_days 60, contract_months 24, effective_date "2027-01-01"
> Hello,
> 
> Thank you for moving on contract_months, payment_days, unit_price. That helps.
> Our should-cost estimate for PH-100 (cost:part:PH-100) sits well below the new price.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> What would you need from us to get closer to these numbers?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 2 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-2`: unit_price 51.4, payment_days 60, contract_months 24, effective_date "2027-01-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. 
> 
> Our family foundry values the long relationship we share with Hollerau Pumpenwerke GmbH, so we have looked very closely at the figures. We checked the should cost data you cited; it holds and we took it into account. We have reviewed your should-cost estimate, and while our internal calculations differ, we are prepared to make a concession. 
> 
> Our offer stands at a price of €51.40 per unit, Zahlungsziel 60 days net, a contract term of 24 months, valid from 1 January 2027. This offer remains valid for 30 days.
> 
> Beside this, we can offer €50.90 per unit based on your package with 30-day payment terms and a start date of December 1, 2026, featuring a price of €50.90 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. 
> 
> To get closer to your proposed figures, we would require a commitment to higher order volumes. Which volume can you commit to? A binding higher volume would help us and can improve the price.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We checked the should cost data you cited; it holds and we took it into account.
- We have reviewed your should-cost estimate, and while our internal calculations differ, we are prepared to make a concession.
- We can offer €… per unit based on your package with 30-day payment terms and a start date of December … ….
- To get closer to your proposed figures, we would require a commitment to higher order volumes.
- Which volume can you commit to?
- A binding higher volume would help us and can improve the price.
### Round 3 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 47.87, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 47.86, payment_days 45, contract_months 24, effective_date "2027-02-01"
- term sheet: unit_price 48.1, payment_days 60, contract_months 24, effective_date "2027-01-01"
> Hello,
> 
> Thank you for moving on effective_date, unit_price. That helps.
> Your latest scorecard (sc:DEMO-F1@2026Q3) is part of how we review the partnership.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 3 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-3`: unit_price 50.7, payment_days 30, contract_months 24, effective_date "2026-12-01"
- claims: [{"index": 0, "result": "verified"}]
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We note your reference to our scorecard, which reflects our strong delivery record and dedication to our partnership. 
> 
> In response to your adjustment, we are prepared to lower our price to €50.70 per unit for the package with 30-day payment terms starting December 1, 2026. For this offer, we present a price of €50.70 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. Our Lieferzeit is 35 days. This offer remains valid for 30 days.
> 
> To close the remaining gap as you asked, we reiterate our previous question: what binding higher volume can you commit to? Which volume can you commit to?
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We note your reference to our scorecard, which reflects our strong delivery record and dedication to our partnership.
- In response to your adjustment, we are prepared to lower our price to €… per unit for the package with 30-day payment terms starting December … ….
- To close the remaining gap as you asked, we reiterate our previous question: what binding higher volume can you commit to?
- Which volume can you commit to?
- Our Lieferzeit is … days.
### Round 4 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 48.11, payment_days 30, contract_months 24, effective_date "2026-12-01"
- term sheet: unit_price 48.11, payment_days 45, contract_months 24, effective_date "2027-04-01"
- term sheet: unit_price 48.1, payment_days 60, contract_months 24, effective_date "2027-01-01"
> Hello,
> 
> Thank you for moving on effective_date, payment_days, unit_price. That helps.
> Our latest order (po:4500001342) confirms the steady volume.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 4 · sup:DEMO-F1
**open**
- term sheet `offer:DEMO-F1-4`: unit_price 50.5, payment_days 30, contract_months 24, effective_date "2026-12-01"
- signals: {"reply_delay_days": 2, "validity_days": 30}
> Guten Tag,
> 
> We have reviewed your offer and can adjust our Angebot as follows. We note your reference to recent orders, but to close the remaining gap we need a binding commitment to higher volumes. Recognizing your wish to conclude this today, we are reducing our price to €50.50 per unit for the package with 30-day payment terms. 
> 
> Our current Angebot stands at a price of €50.50 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 December 2026. This offer remains valid for 30 days.
> 
> Please let us know what exact volume increase you can commit to so we can finalize this agreement. Which figures is that based on? Please send us the data. Which volume can you commit to?
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We note your reference to recent orders, but to close the remaining gap we need a binding commitment to higher volumes.
- Recognizing your wish to conclude this today, we are reducing our price to €… per unit for the package with 30-day payment terms.
- Please let us know what exact volume increase you can commit to so we can finalize this agreement.
- Which figures is that based on? Please send us the data.
- Which volume can you commit to?
### Round 5 · buyer
Pump housing PH-100: the foundry wants +8.8 %
- term sheet: unit_price 48.48, payment_days 30, contract_months 24, effective_date "2027-01-01"
- term sheet: unit_price 48.64, payment_days 45, contract_months 24, effective_date "2027-04-01"
- term sheet: unit_price 48.79, payment_days 60, contract_months 24, effective_date "2027-02-01"
> Hello,
> 
> Thank you for moving on unit_price. That helps.
> We put together 3 packages; each works equally well for us, so pick the one that suits you best.
> How could we close the remaining gap today?
> 
> Best regards
> Hollerau Pumpenwerke, Purchasing
### Round 5 · sup:DEMO-F1
**final_offer**
- term sheet `offer:DEMO-F1-5`: unit_price 50.4, payment_days 30, contract_months 24, effective_date "2027-01-01"
- signals: {"reply_delay_days": 3, "validity_days": 7}
> Guten Tag,
> 
> We appreciate your revised offer, though we still await your response regarding a binding volume commitment. We are prepared to accept the January 1, 2027 start date you proposed in your first package. With this start date, we can reduce our price to €50.40 per unit, but we must insist on clarifying the volume. Which volume can you commit to?
> 
> This is our final offer (letztes Angebot). Please decide. Our Angebot stands at a price of €50.40 per unit, Zahlungsziel 30 days net, a contract term of 24 months, valid from 1 January 2027. This offer remains valid for 7 days. Our family foundry values the long relationship we have built together over the years, and we take great pride in delivering quality work from our region.
> 
> Viele Grüße aus der Gießerei
> Andreas Moser
> Owner, Demo Gießerei GmbH

**Reasons:**
- We appreciate your revised offer, though we still await your response regarding a binding volume commitment.
- We are prepared to accept the January … … start date you proposed in your first package.
- With this start date, we can reduce our price to €… per unit, but we must insist on clarifying the volume.
- Which volume can you commit to?
### Round 5 · buyer

## Team notes

_Observations from replays, calls with Tacto, hunches. Kept when the note is regenerated._
