"""The engine's LLM writer: the model only rewrites words; the template goes whenever it breaks a rule."""

import json
import time

from arena_kit.agents import engine_writer

DRAFT = "\n".join(
    [
        "Hello,",
        "",
        "Thank you for the quick answer.",
        "Our forecast fc:SH-220@2026-09 confirms 6,000 pieces a year for 24 months.",
        "For transparency: another supplier's offer (offer:DEMO-C1-1) is €15.80, 14 days payment; I attach it.",
        "We put together 2 packages; each works equally well for us, so pick the one that suits you best.",
        "How could we close the remaining gap today?",
        "",
        "Best regards",
        "Hollerau Pumpenwerke, Purchasing",
    ]
)
MSG = {"subject": "SH-220", "body": DRAFT, "term_sheets": [{"terms": {"unit_price": 14.12}}], "refs": []}
CASE = {"title": "SH-220", "type": "rfq", "fixed_terms": {"volume_per_year": 6000}}
ID_LINES = [line for line in DRAFT.splitlines() if ":" in line and ("fc:" in line or "offer:" in line)]


def answer(body):
    return lambda system, user: json.dumps({"body": body})


def good_body():
    return "\n".join(
        [
            "Hello,",
            "",
            "Thank you for your quick and constructive reply - we appreciate the movement.",
            *ID_LINES,
            "Both attached packages work equally well for us, so please pick the one that suits you best.",
            "How could we close the remaining gap today?",
            "",
            "Best regards",
            "Hollerau Pumpenwerke, Purchasing",
        ]
    )


def test_a_rewrite_that_keeps_every_id_line_and_figure_goes_out(monkeypatch):
    monkeypatch.setenv("ENGINE_WRITER", "llm")
    out = engine_writer.prepare(answer(good_body()), MSG, CASE, "Which volume can you commit to?")
    assert out["body"] == good_body() and out["term_sheets"] == MSG["term_sheets"]


def test_new_figures_dropped_ids_or_no_signature_keep_the_template(monkeypatch):
    monkeypatch.setenv("ENGINE_WRITER", "llm")
    bad = [
        good_body().replace("constructive reply", "reply at EUR 13.90"),  # a figure the code never chose
        good_body().replace(ID_LINES[0], "Our forecast confirms the volume."),  # the fact's ID is gone
        good_body().replace("Hollerau Pumpenwerke, Purchasing", "Purchasing"),
        good_body() + " word" * 250,
    ]
    for body in bad:
        assert engine_writer.prepare(answer(body), MSG, CASE, "")["body"] == DRAFT


def test_it_may_repeat_figures_from_our_sheets_or_their_e_mail_and_text_after_the_json_is_ignored(monkeypatch):
    monkeypatch.setenv("ENGINE_WRITER", "llm")
    body = good_body().replace("we appreciate the movement", "your move to 15.20 for 24 months helps")
    out = json.dumps({"body": body}) + '\n\nNote: {"kept": "every ID"}'  # a second object after the first
    msg = {**MSG, "term_sheets": [{"terms": {"unit_price": 14.12, "contract_months": 24}}]}
    assert engine_writer.prepare(lambda s, u: out, msg, CASE, "We can offer EUR 15.20.")["body"] == body


def test_a_failed_or_slow_model_keeps_the_template(monkeypatch):
    monkeypatch.setenv("ENGINE_WRITER", "llm")
    monkeypatch.setattr(engine_writer, "WRITE_S", 0.2)

    def boom(system, user):
        raise RuntimeError("429")

    def slow(system, user):
        time.sleep(1)
        return json.dumps({"body": good_body()})

    for complete in (boom, slow, lambda s, u: "not json"):
        t0 = time.monotonic()
        assert engine_writer.prepare(complete, MSG, CASE, "")["body"] == DRAFT
        assert time.monotonic() - t0 < 0.9


def test_a_style_instruction_is_added_to_the_system_prompt(monkeypatch):
    monkeypatch.delenv("ENGINE_STYLE", raising=False)
    assert engine_writer.system() == engine_writer.SYSTEM
    monkeypatch.setenv("ENGINE_STYLE", "Brief and factual.")
    assert engine_writer.system().startswith(engine_writer.SYSTEM) and "Brief and factual." in engine_writer.system()


def test_vary_tags_the_subject_only_and_off_changes_nothing(monkeypatch):
    monkeypatch.setenv("ENGINE_WRITER", "vary")
    out = engine_writer.prepare(None, MSG, CASE, "")
    assert out["body"] == DRAFT and out["subject"].startswith("SH-220 (ref ")
    monkeypatch.delenv("ENGINE_WRITER")
    assert engine_writer.prepare(answer(good_body()), MSG, CASE, "") is MSG
