# Gold utterance set

`utterances.csv` is the **read-only** source of truth for parser and live-commit
evaluation. Nothing in the harness edits, reformats, re-saves, or normalises the
file. Its SHA-256 is recorded in validation and report output.

## Columns

| Column | Meaning | Allowed values (after documented repairs) |
| --- | --- | --- |
| `text` | Exact utterance as spoken/typed. | non-empty |
| `label` | Intended speech act. | `command`, `proposal`, `question`, `confirm`, `reject`, `undo`, `view`, `ignored`; compound forms such as `command;width` use a known base label and parameter suffix |
| `parameter` | Expected simulation parameter(s). | `height`, `width`, `projection`, `rotation`, `fullness`, `definition`; `;` separates multiple expected edits |
| `direction` | Expected direction(s). | `up`, `down`; `;` separated |
| `value` | Expected magnitude(s). | numeric, `;` separated. Blank is allowed for non-commands and for commands whose expected value is genuinely absent |
| `unit` | Expected unit(s). | `mm`, `cm`, `degrees`, `inch`; `;` separated. Blank for non-commands |
| `side` | Expected side, if spoken. | blank in this dataset; `left`, `right`, `both`, `bilateral` are accepted |
| `note` | Human note about the case. | free text |
| `conversation_id` | Conversation/session id. | non-empty |
| `turn_index` | Turn within the conversation. | non-empty |
| `source` | Provenance. | `synthetic` in this dataset |

`conversation_id:turn_index` is the row key used by `splits.json` and by the
report. Multi-command rows use semicolons in `parameter`, `direction`, `value`,
and `unit`; the first component lines up with the first spoken edit.

## Label vocabulary and current counts

| Label | Count | Category used by reports |
| --- | ---: | --- |
| `command` | 99 | direct command |
| `command;width` | 1 | direct command (compound-label anomaly) |
| `proposal` | 59 | proposal |
| `question` | 7 | question |
| `confirm` | 8 | confirm |
| `reject` | 7 | reject |
| `undo` | 5 | undo |
| `view` | 5 | view |
| `ignored` | 74 | chatter / unsupported / ambiguous |
| **Total** | **265** | |

The headline metric treats every category except `direct_command` as a
non-command:

```
false_commit_rate =
    non-command rows where the real TS evaluateLiveInstruction applies anything
    ---------------------------------------------------------------------------
                         all non-command rows
```

`command;width` is the dataset's only compound label. It is read as a command
(and its `width` suffix is validated as a parameter).

## Dataset assumptions and known anomalies

The data is synthetic and small. Six utterances are exact duplicates in
different conversations (for example `raise the nasal bridge by 2 mm` and
`yes do that`); they are reported as warnings and kept, because the split is
conversation-aware and duplicate wording in different conversations is still a
valid test of the same behaviour. Near-duplicate checking uses >95 fuzzy
similarity.

Three rows have known comma/shift typos. They are repaired **in memory only** by
`backend/app/eval/gold_io.py` and are listed in every validation run:

- `sess129:1` — missing blank `side` cell; fields from `side` onward shift left.
- `sess197:1` — one extra blank cell before the value; one blank is dropped.
- `sess248:1` — compound label plus shifted slot columns. The slot values cannot
  be trusted, so the row is scored for its text and command label but its
  `parameter/direction/value/unit/side` columns are ignored.

These repairs are an explicit assumption, not a silent normalisation. Any other
malformed row fails validation.

Rare categories (under 5% of 265 rows: fewer than 13 rows) are `confirm` (8),
`question` (7), `reject` (7), `undo` (5), and `view` (5). They are kept; the
stratified split gives each an appropriate dev/test share, and per-category
metrics are reported with their small-sample caveat.

## Deterministic split

`make_splits.py` produces `splits.json` with a fixed seed (`20261030`), 70% dev
and 30% test, stratified by base label. It refuses to overwrite an existing file
unless `--force` is passed. The split is generated from sorted row keys and
Python's seeded `random.Random`, so repeated runs are reproducible.

## Commands

From `backend/`:

```powershell
..\\.venv\\Scripts\\python.exe tests\\gold\\validate_gold.py
..\\.venv\\Scripts\\python.exe tests\\gold\\make_splits.py
..\\.venv\\Scripts\\python.exe -m app.eval.cli --check
```

`--check` verifies the committed parse/live-decision fixtures and baseline
without rewriting them. `--write-report` refreshes the ignored
`reports/latest.json` and `reports/latest.md`.

## What is deliberately *not* here

- No model weights, audio clips, or secrets are committed.
- The existing `backend/app/eval/run_gold.py` and
  `backend/tests/test_gold_eval.py` are kept as-is. The new harness is separate
  and uses the real TypeScript live decision rather than the old shortcut.
- No face or head geometry is added.
