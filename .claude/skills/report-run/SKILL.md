---
name: report-run
description: Turn the last run into one self-contained HTML report - verdicts, failures with their screenshots, confirmed defects and coverage gaps - and say what it shows. Use after a regression when somebody outside the repo needs the result, or when asked for a report, a summary or a dashboard of a run.
---

# Report a run

Input: a finished run.
Output: `reports/report-<platform>.html`, plus a short written summary of what it
says. The file is self-contained - screenshots are inlined - so it can be attached
to a ticket or forwarded without its folder.

This does **not** run the suite (`run-regression` does) and does not decide
whether a failure is a bug (`debug-test-failure` and the triage rules do). It
reports what happened.

## 1. Check there is a run to report on

```bash
ls test-results/cost-*.jsonl
```

That file is written during the run, one line per test. If it is missing, no run
has finished on this machine since the framework last started one - report that
rather than generating something from stale XML.

⚠️ **Never report on a run you did not just see finish**, unless the user asked
for the previous one explicitly. `test-results/` survives across runs and a stale
report is worse than no report: it is confidently wrong about the current build.

## 2. Generate it

```bash
npm run report                      # the platform of the most recent run
npm run report -- --platform ios    # pick one
npm run report -- --open            # ...and open it
```

## 3. Read it before you hand it over

The report is evidence, so check it says what you think it says.

| Look at | What it means |
|---|---|
| **failures** | Each carries the first line of its error and the errorshot taken at the moment it failed. If a failure has no screenshot, say so - it usually means the session had already died. |
| **нестабільні** (unstable) | A test that ran more than once. The report shows the **first** attempt's verdict, because a spec-file retry of a non-idempotent suite manufactures failures that never happened (rule 10). A test appearing here is worth a look on its own. |
| **дефекти** | Read out of `APP_ISSUES.md`. These are defects a person already confirmed, NOT this run's failures - a green run still lists them. |
| **покриття** | Per screen, from `COVERAGE.md`. The "не перевіряє" column is the honest half. |

## 4. Say what it shows

Do not just hand over a path. Report, in a few lines:

```
Report:   reports/report-android.html
Verdict:  <n> tests, <n> passed, <n> failed, <duration>
Failures: <title> - <one line on what it looks like>, errorshot attached
Cost:     <n> driver calls total (from the `[report]` stdout line, not the HTML)
Unstable: <none | which tests ran twice>
Known:    <n> confirmed defects listed (not this run's failures)
```

⚠️ **A red run is not automatically bad news, and a green one is not automatically
good.** If a failure is a known open defect kept red on purpose, say that - it is
the suite working. If the run is green but a suite that should have run did not
appear, say that too.

## 5. When the report is going outside the team

Three things to check before it leaves:

- **No secrets in a failure message.** Error text is printed verbatim.
- **No customer data in a screenshot.** The errorshot is the real screen.
- **The app build is named.** A report that does not say which build it describes
  cannot be acted on later.
