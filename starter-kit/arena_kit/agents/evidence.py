"""Evidence-based sandbox policy for testing conditional package trades.

The D01 sequence is grounded in a prior successful manual replay. The D02 styles
probe cash, delivery and freight trades against the two sandbox suppliers.
These are demo-tuned experiments, not a policy validated on practice cases.
"""

from ..cost import complete_offer, must_haves_ok, total_cost
from ..docs import standard_terms
from ..play import latest, live_threads, standing


def _count(events):
    return sum(m.get("from") == "buyer" for m in events)


def _message(case, body, terms, refs=()):
    return {"subject": case["title"], "body": body,
            "term_sheets": [{"terms": complete_offer(case, t)} for t in terms], "refs": list(refs)}


def _offers(case, threads):
    """Current valid supplier sheets, including alternatives, ranked by full buyer cost."""
    found = []
    for sid in live_threads(threads):
        events = threads[sid]
        std = standard_terms(events)
        for sheet in latest(events).get("term_sheets") or []:
            terms = sheet.get("terms") or {}
            if not terms.get("unit_price") or not must_haves_ok(case, terms, std):
                continue
            found.append((total_cost(case, terms, std), sid, sheet["term_sheet_id"], terms))
    return sorted(found)


def _accept(best):
    return {"supplier_id": best[1], "message": {"action": {"type": "accept", "term_sheet_id": best[2]}}}


class EvidenceTraderAgent:
    def __init__(self, d02_style="cash", d02_target_cost=168250):
        if d02_style not in {"cash", "balanced", "growth", "lot", "proof", "j1_cost", "j1_soft", "j1_dap"}:
            raise ValueError("unsupported D02 style")
        self.d02_style = d02_style
        self.d02_target_cost = d02_target_cost

    def decide(self, case, threads):
        if case.get("type") == "price_increase" and len(threads) == 1:
            return self._foundry(case, threads)
        if case.get("type") == "rfq" and len(threads) == 2:
            return self._rfq(case, threads)
        raise ValueError("This sandbox probe supports the D01 and D02 case structures only")

    def _foundry(self, case, threads):
        sid = next(iter(threads))
        events = threads[sid]
        count = _count(events)
        offers = _offers(case, threads)
        if offers and offers[0][0] <= 416500 and count >= 3:
            return _accept(offers[0])
        if latest(events).get("status") in {"agreed", "final_offer"}:
            return _accept(offers[0]) if offers else {"supplier_id": sid, "message": {"action": {"type": "walk_away"}}}
        if count == 0:
            terms = [
                {"unit_price": 50.0, "payment_days": 45, "contract_months": 24, "effective_date": "2027-04-01"},
                {"unit_price": 49.5, "payment_days": 30, "contract_months": 24, "effective_date": "2027-04-01"},
            ]
            body = ("Thank you for the quote. We value our 12-year relationship and can commit to "
                    "4,000 housings a year for 24 months, supported by our order history. In return, "
                    "please phase the new price in from 1 April 2027. Which package works for you?")
            refs = [ref for ref in case.get("refs", []) if ref.startswith("po:")]
        elif count == 1:
            terms = [{"unit_price": 49.8, "payment_days": 30, "contract_months": 24,
                      "effective_date": "2027-04-01"}]
            body = ("Thank you, that moves us closer. Paying within 30 days helps your cash flow. "
                    "Would 30-day payment with a 24-month commitment and an April start allow a lower price?")
            refs = []
        elif count == 2:
            terms = [{"unit_price": 50.2, "payment_days": 30, "contract_months": 24,
                      "effective_date": "2027-02-01"}]
            body = ("We appreciate your flexibility. On your proposed February start with "
                    "30-day payment and 24 months, could you reach €50.20? We can sign today.")
            refs = []
        else:
            price = min((s[3]["unit_price"] for s in offers), default=50.5)
            terms = [{"unit_price": min(price, 50.5), "payment_days": 30, "contract_months": 24,
                      "effective_date": "2027-02-01"}]
            body = "Thank you. We can meet at €50.50 on these terms and sign immediately."
            refs = []
        return {"supplier_id": sid, "message": _message(case, body, terms, refs)}

    def _rfq(self, case, threads):
        offers = _offers(case, threads)
        if offers and offers[0][0] <= self.d02_target_cost:
            return _accept(offers[0])
        live = live_threads(threads)
        if not live:
            raise ValueError("No live suppliers")
        active = [sid for sid in live if latest(threads[sid]).get("status") not in {"agreed", "final_offer"}]
        uncontacted = [sid for sid in active if _count(threads[sid]) == 0]
        if uncontacted:
            sid = min(uncontacted, key=lambda s: 0 if s.endswith("C1") else 1)
        elif (active and self.d02_style in {"j1_cost", "j1_soft", "j1_dap"} and
              _count(threads.get("sup:DEMO-J1", [])) == 1):
            sid = "sup:DEMO-J1"
        elif (active and self.d02_style == "j1_dap" and "sup:DEMO-J1" in active and
              _count(threads["sup:DEMO-J1"]) < 4):
            sid = "sup:DEMO-J1"
        elif active:
            sid = min(active, key=lambda s: (_count(threads[s]), 0 if s.endswith("C1") else 1))
        elif offers:
            return _accept(offers[0])
        else:
            return {"supplier_id": live[0], "message": {"action": {"type": "walk_away"}}}
        events = threads[sid]
        count = _count(events)
        if count >= 4:
            return _accept(offers[0]) if offers else {"supplier_id": sid, "message": {"action": {"type": "walk_away"}}}
        is_c1 = sid.endswith("C1")
        if count == 0:
            return {"supplier_id": sid, "message": self._opening(case, is_c1, threads)}
        return {"supplier_id": sid, "message": self._followup(case, is_c1, count, standing(events)[1], threads)}

    def _opening(self, case, is_c1, threads):
        if self.d02_style == "balanced":
            terms = [
                {"unit_price": 15.2, "payment_days": 60, "lead_time_days": 35, "incoterm": "DAP"},
                {"unit_price": 14.9, "payment_days": 30, "lead_time_days": 35, "incoterm": "FCA"},
                {"unit_price": 14.6, "payment_days": 14, "lead_time_days": 42, "incoterm": "EXW"},
            ]
        elif self.d02_style in {"j1_cost", "j1_soft", "j1_dap"} and not is_c1:
            terms = [
                {"unit_price": 13.8, "payment_days": 14, "lead_time_days": 35, "incoterm": "DAP"},
                {"unit_price": 13.4, "payment_days": 14, "lead_time_days": 42, "incoterm": "EXW"},
                {"unit_price": 14.0, "payment_days": 14, "lead_time_days": 35, "incoterm": "FCA"},
            ]
        else:
            terms = [
                {"unit_price": 14.5, "payment_days": 14, "lead_time_days": 42, "incoterm": "EXW"},
                {"unit_price": 14.8, "payment_days": 14, "lead_time_days": 42, "incoterm": "FCA"},
                {"unit_price": 15.0, "payment_days": 14, "lead_time_days": 35, "incoterm": "DAP"},
            ]
        intro = "We can commit to 6,000 shafts a year over 24 months, as our forecast shows. "
        if self.d02_style == "lot":
            intro += ("Please also quote four 1,500-unit release lots each year, keeping the "
                      "42-day maximum lead time; that is the same annual volume. ")
        else:
            intro += "Our planning baseline is 500 per month. "
        if is_c1:
            body = ("Dear Ms Kaczmarek, thank you for the quote. " + intro +
                    "We can pay in 14 days and arrange pickup under EXW. Please confirm a lead time "
                    "within 42 days. Which of these packages works best for your growing operation? "
                    "If a larger binding lot would change the price, please quote the exact tradeoff.")
        else:
            competing = _offers(case, {"sup:DEMO-C1": threads["sup:DEMO-C1"]})
            comp = (f" The Polish supplier's current valid {competing[0][2]} is "
                    f"€{competing[0][3]['unit_price']:.2f}, 14-day payment, "
                    f"{competing[0][3].get('lead_time_days')}-day lead and "
                    f"{competing[0][3].get('incoterm')}. " if competing else "")
            body = ("Dear Ms Aigner, thank you for the 28-day quote. " + intro +
                    "We can pay in 14 days, permit 42 days for standard production, and arrange EXW pickup. " +
                    (comp if self.d02_style in {"j1_cost", "j1_soft", "j1_dap"} else
                     "Another qualified supplier has quoted €16.00 EXW, although its lead time is unresolved. ") +
                    "Could you price these alternatives for a firm award and explain the cost tradeoffs?")
        refs = (["news:N-0412"] if self.d02_style in {"j1_cost", "j1_soft", "j1_dap"} and not is_c1
                else ["fc:SH-220@2026-09"])
        return _message(case, body, terms, refs)

    def _followup(self, case, is_c1, count, theirs, threads):
        price = float(theirs.get("unit_price") or (16 if is_c1 else 17.1))
        ask = round(max(13.5, price - (0.45 if count == 1 else 0.25)), 2)
        if self.d02_style == "growth" and is_c1:
            ask = round(max(13.5, price - 0.65), 2)
        terms = [
            {"unit_price": ask, "payment_days": 14, "lead_time_days": 42, "incoterm": "EXW"},
            {"unit_price": round(ask + 0.25, 2), "payment_days": 14, "lead_time_days": 35, "incoterm": "FCA"},
        ]
        other = "sup:DEMO-J1" if is_c1 else "sup:DEMO-C1"
        other_offers = _offers(case, {other: threads[other]}) if other in threads else []
        comp = (f" The other supplier currently offers €{other_offers[0][3]['unit_price']:.2f} "
                f"with {other_offers[0][3].get('payment_days', 'unspecified')}-day payment; "
                "we are comparing complete packages.") if other_offers else ""
        if is_c1:
            refs = ["cost:part:SH-220", "sc:DEMO-C1@2026Q3"] if count == 1 else []
            body = ("Dear Ms Kaczmarek, thank you for clarifying your offer. Our 6,000 annual units "
                    "are a firm 24-month requirement. We can keep 14-day payment and EXW pickup; "
                    "please exchange those commitments for a sharper base price." + comp +
                    " Could you quote the price for larger call-off lots without changing the annual volume?")
            if self.d02_style == "lot":
                body += (" Specifically, we propose four binding 1,500-unit release lots each year, "
                         "with your 42-day lead time on each lot. Please quantify the saving "
                         "against monthly 500-unit releases in your next offer.")
            if self.d02_style == "proof" and other_offers:
                quote = other_offers[0]
                body += (f" For reference, {other} offered {quote[2]} at "
                         f"€{quote[3]['unit_price']:.2f}, {quote[3].get('payment_days')}-day payment, "
                         f"{quote[3].get('lead_time_days')}-day lead and {quote[3].get('incoterm')} delivery. "
                         "These are the terms we received and are comparing for the award.")
        else:
            refs = []
            if count == 1:
                refs = ["cost:part:SH-220"]
                if self.d02_style in {"j1_cost", "j1_soft", "j1_dap"}:
                    refs.append("sc:DEMO-J1@2026Q3")
            cadence = ("four 1,500-unit release lots per year " if self.d02_style == "lot"
                       else "predictable 500-unit monthly orders ")
            body = ("Dear Ms Aigner, we can give your workshop " + cadence +
                    "and 14-day payment. A 42-day lead avoids overtime; we can arrange EXW pickup. "
                    "Please show the price for this lower-cost production package." + comp +
                    " We can award promptly if you can close the gap.")
            if self.d02_style in {"j1_cost", "j1_soft", "j1_dap"}:
                ask = 13.4 if count == 1 else 13.6
                terms = [
                    {"unit_price": ask, "payment_days": 14, "lead_time_days": 42, "incoterm": "EXW"},
                    {"unit_price": round(ask + 0.4, 2), "payment_days": 14,
                     "lead_time_days": 35, "incoterm": "DAP"},
                    {"unit_price": round(ask + 0.2, 2), "payment_days": 14,
                     "lead_time_days": 35, "incoterm": "FCA"},
                ]
                attachments = [a.get("text", "") for event in threads["sup:DEMO-J1"]
                               for a in event.get("attachments") or []]
                if any(all(str(n) in att for n in ("5.56", "4.39", "2.81")) for att in attachments):
                    if count == 1:
                        body += (" Your attached cost breakdown shows €5.56 material, €4.39 labour "
                                 "and €2.81 conversion, or €12.76 direct cost. A 24-month award "
                                 "with quick payment supports a positive margin at our proposed price.")
                body += " Which of these three complete packages can you approve?"
                if self.d02_style == "j1_soft" and count >= 2:
                    terms = [
                        {"unit_price": 13.7, "payment_days": 14, "lead_time_days": 42, "incoterm": "EXW"},
                        {"unit_price": 13.9, "payment_days": 14, "lead_time_days": 35, "incoterm": "FCA"},
                        {"unit_price": 13.8, "payment_days": 14, "lead_time_days": 35, "incoterm": "DAP"},
                    ]
                    body = ("Dear Ms Aigner, thank you for the improved offer and for checking the "
                            "evidence. We can award the full 24-month volume promptly at 14-day payment. "
                            "Please choose the production and delivery package that best protects your "
                            "margin while meeting our complete landed-cost target.")
                if self.d02_style == "j1_dap" and count >= 2:
                    terms = [
                        {"unit_price": 14.0, "payment_days": 14, "lead_time_days": 35, "incoterm": "DAP"},
                    ]
                    body = ("Dear Ms Aigner, your €14.10 FCA offer is close. Since delivered cost "
                            "determines our award, can your workshop consolidate shipment and "
                            "confirm €14.00 DAP with the same 14-day payment, 35-day lead and "
                            "6,000 annual units for 24 months? If that shipping package works, "
                            "we can sign now. Please quote the exact delivered price.")
        return _message(case, body, terms, refs)
