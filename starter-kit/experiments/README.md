# Comparing negotiation algorithms

`arena-experiment` runs fresh sessions for every strategy × case × repetition. By default it only
previews the batch. Hosted experiments are restricted to the sandbox; the command cannot target
hosted practice or the final.

```bash
cd starter-kit
uv sync --extra sim --group dev
uv run arena-experiment --config experiments/demo.json
uv run arena-experiment --config experiments/demo.json --execute
```

The included `tournament.json` compares the existing naive baseline with three policy variants:
`controlled_A` is a fixed linear concession schedule, `adaptive_B` adds response-aware package
search and early supplier coordination, and `bandit_C` selects between the controlled and adaptive
schedule using within-session cost-improvement feedback. Three repetitions across two demos create
24 sessions. Sandbox runs do not use the team's practice quota. These variants use deterministic
email templates so the comparison focuses on bargaining behavior; no LLM calls or model costs are
involved. The LLM email layer can be added after the economic policies are compared.

The C policy is an online contextual bandit prototype, not pretrained reinforcement learning. It
has no cross-session training data: its estimates reset for every fresh negotiation. This is an
exploration of the learning-enhanced architecture, not evidence that RL is already useful here.

## Adding the algorithm

Use the starter kit's existing policy interface. Put a factory in an importable module; every
trial calls it again with a fresh copy of its settings. Keep policy memory on the instance rather
than in mutable module globals:

```python
def create_agent(**settings):
    return MyNegotiationAgent(**settings)

class MyNegotiationAgent:
    def decide(self, case, threads):
        # case is the buyer's case file. threads contains all supplier and buyer messages;
        # supplier attachments have already been read into their "text" fields.
        # Return one existing arena message, including every negotiable term when bidding:
        return {
            "supplier_id": supplier_id,
            "message": {
                "subject": case["title"],
                "body": email,
                "term_sheets": [{"terms": complete_terms}],
                "refs": verified_fact_ids,
            },
        }
```

To close, return a message containing `{"action": {"type": "accept", "term_sheet_id": offer_id}}`
or `{"action": {"type": "walk_away"}}`. The factory receives `kwargs` from the experiment config:

```json
{"name": "candidate-v1", "factory": "arena_kit.agents.candidate:create_agent",
 "kwargs": {"concession_step": 0.02}}
```

Add that entry after the baseline in `strategies`. The first strategy is the comparison baseline.
Keep credentials in environment variables. Use a fixed model, prompt and parameters per candidate;
commit the algorithm and config before the scored batch. Factories can read data or initialise model
clients before the session opens. Set model-call timeouts inside the policy: the runner records
decision time but cannot interrupt a stuck `decide()` call.

## Test stages

1. **Local API check.** Run every local simulator case to catch invalid offers, document handling,
   multi-supplier state and closing mistakes. The simulator is scripted; its score is not evidence
   of a good strategy against hosted suppliers. With a separately started simulator and its own
   key in `ARENA_API_KEY`, use `--target sim --url http://127.0.0.1:8000`. The sim target accepts only
   a loopback URL and reads its available cases, including custom case files if loaded.
2. **Hosted smoke check.** Run D01 and D02 once per strategy (`--repeats 1`). Check the replay,
   all accepted terms, and supplier contacts. In D02, the policy is responsible for engaging both
   supplier threads; the report records which suppliers it contacted.
3. **Screen candidates.** Run baseline and candidate on both cases for three repetitions. Strategy
   order is shuffled within each case/repetition block. A schedule seed makes that order repeatable,
   but the API provides no seed for the hosted suppliers. Change one strategy feature at a time.
4. **Retest finalists.** Give the best candidate and baseline ten repetitions per case (40 sessions
   for two strategies). Compare per-case mean score, variability, worst run, deal rate and failures.
   Three runs are only a screening signal. Investigate tradeoffs across D01 and D02 before choosing.

There are two hosted demo cases with three supplier bots: D01 is a foundry price increase; D02 is
an RFQ with two suppliers. Demo results are development evidence, not a guarantee on unseen final
cases. A subsequent full practice sweep needs the team's explicit quota decision.

## Records and interpretation

Each batch writes a unique folder under ignored `logs/experiments/`:

- `manifest.json`: config, randomised schedule, public case files, commit, dirty-worktree flag,
  selected model settings, endpoint and times.
- `trials.json`: each session ID (saved immediately after opening), outcome, terms, costs, official
  score, supplier contacts, decision times, errors and replay URL.
- `sessions/`: completed server session traces, including supplier reasons, for later analysis.
- `results.csv` and `report.md`: a comparison per case and paired score differences from baseline.

The runner executes one case at a time using the existing `play()` conversation loop. Within a
case the algorithm chooses which supplier to message next. The recorded policy decision time
excludes attachment downloads and server response time; it is a diagnostic, not proof of meeting
every supplier's 60-second reply window. A sequential demo batch does not validate final-wave
parallelism; that needs a later rehearsal of the final runner.

Failed algorithm trials count as zero in the **experiment score**, even if cleanup obtains an
alternative score. The arena's actual score is retained separately. Failed trials are never silently
dropped. On failure or Ctrl-C the runner attempts to close only the session it created; if closure
cannot be confirmed, it stops the batch and records the session ID. A process killed without cleanup
leaves its saved session ID for inspection; do not relaunch blindly. `--execute` always starts a new
batch, and does not resume an interrupted one.

`C_best` and supplier reasons from ended sessions are for analysis, not live policy inputs. Select
strategies by scores and costs across repeated runs, not one lucky result or unit price alone.
Promote conclusions and a few representative replay links into Obsidian; raw trial files stay in
the ignored output directory. Known secret environment values are redacted from saved artifacts.
