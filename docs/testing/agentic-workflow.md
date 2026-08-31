# The agentic workflow

**The loop is: build → run → explore → report → decide.** A person sets direction and
reviews; the framework's own tooling does the volume work. This page is the roster and
the rules that keep it honest.

Nothing here runs on a schedule and nothing commits. Every loop starts because someone
asked, and ends with output for a person to read.

## The loop

```
        ┌─────────────────────────────────────────────────────┐
        │                                                     │
   build ──────► run ──────► explore ──────► report ──────► decide
     │            │             │               │              │
 capture a     the suite,   where the      findings,        a person:
 screen,       triaged      suite does     coverage,        file it? cover
 declare it,   against      not go         cost             it? exclude it?
 write a spec  known causes                                 close the loop
```

Each arrow is a skill. Each box produces evidence a person can check without
re-running anything.

## Skills - procedure, loaded into whoever is working

| | |
|---|---|
| [`inspect-live-screen`] | capture a screen's real tree, both platforms |
| [`create-page-object`] | declare it, respecting THE ONE RULE |
| [`import-cases`] | foreign-format cases → `requirements/REQ-*.md`, ids kept |
| [`automate-requirement`] | a requirement or test case → a justified plan |
| [`create-test`] | write the spec |
| [`run-regression`] | run the suite, stamp what it describes, triage, report |
| [`report-run`] | the last run → one self-contained HTML report |
| [`debug-test-failure`] | triage one failure against known causes |
| [`explore-app`] | a charter-based session - the half a regression cannot do |
| [`cover-gap`] | a finding → coverage that doesn't duplicate what exists |
| [`heal-selectors`] | repair page objects after an app build |
| [`seed-test-data`] | deterministic data the run controls |

## Agents - a separate context, for volume or for parallelism

| | why not just a skill |
|---|---|
| `regression-runner` | a 30-90 minute run whose log nobody should read in full. **One at a time - device-bound** |
| `failure-triage` | one per failure, in parallel. Evidence is bulky; **needs no device** |
| `exploratory-tester` | one charter end to end; a session produces thousands of tree nodes |
| `finding-triage` | is this new, a duplicate, a known gap, or a framework artefact? Read-only |
| `screen-mapper` | a page source is thousands of nodes; the delta is three short lists. **Device-bound** |
| `suite-auditor` | cost, coverage drift, stale exclusions, stale instructions. Read-only |

**The rule for adding another**: an agent earns a separate context only when the
intermediate volume is large and only the conclusion matters, when the work
parallelises, or when it is a long loop nobody should watch. Otherwise a skill is
strictly better - no handoff, no cost.

## What the AI does not decide

Not limitations - deliberate boundaries, each bought with a real mistake:

- **Filing a finding.** Drafts only. On the predecessor project a finding was written
  into `APP_ISSUES.md` and had a test excluded for it; one manual attempt on the
  device retired the whole entry. A wrong entry costs more than a missed one, because
  the file is the deliverable.
- **Excluding a test.** It removes coverage permanently and quietly. `[EXCLUDED]` and
  `itExceptInCI` both need a person - see [suites.md](suites.md#exclusion-policy).
- **Destructive data work.** A shared environment is shared. The run-suffix guard on
  what a suite marks for deletion is structural; nothing routes around it. See
  [../architecture/test-data.md](../architecture/test-data.md).
- **Commits, pushes, tickets.** Work lands in the working tree with a manifest.
- **Anything needing hands on a device** - an OS file picker or a biometric prompt is
  the standing example.

## Two properties that make it trustworthy

**One device, one session.** `maxInstances: 1` governs one process; the device lock
(`scripts/device-lock.mjs`) governs the rest. Two Appium sessions on one device do not
error - they interleave, and the failures read like selector bugs. See
[../guides/devices.md](../guides/devices.md#one-device-one-session).

**Every run says what tree it describes.** A regression can take 90 minutes; if the
code changes underneath it, its results describe something that no longer exists.
That has happened - a fully green run at 19:12 against a tree edited at 20:03,
noticed only by comparing mtimes. So a run stamps the commit and a source hash at
start, re-checks at the end, and the report says which. `npm run config:diff` answers
the narrower version of the same question: did a refactor change the resolved wdio
config? (It proves the *wiring*, not that an extracted helper behaves the same - it
narrows what a regression must prove, and does not replace it.)

## Where the loop is deliberately not autonomous

The framework will happily run for an hour without supervision. It will not:

- decide that a red test is the app's fault rather than its own,
- decide that a finding is worth someone's time,
- decide that coverage may be removed,
- or touch a shared environment destructively.

Those are the four decisions where being wrong is expensive and being slow is not.
Everything else is volume work, and volume work is what this is for.

[`inspect-live-screen`]: ../../.claude/skills/inspect-live-screen/SKILL.md
[`create-page-object`]: ../../.claude/skills/create-page-object/SKILL.md
[`import-cases`]: ../../.claude/skills/import-cases/SKILL.md
[`automate-requirement`]: ../../.claude/skills/automate-requirement/SKILL.md
[`create-test`]: ../../.claude/skills/create-test/SKILL.md
[`run-regression`]: ../../.claude/skills/run-regression/SKILL.md
[`report-run`]: ../../.claude/skills/report-run/SKILL.md
[`debug-test-failure`]: ../../.claude/skills/debug-test-failure/SKILL.md
[`explore-app`]: ../../.claude/skills/explore-app/SKILL.md
[`cover-gap`]: ../../.claude/skills/cover-gap/SKILL.md
[`heal-selectors`]: ../../.claude/skills/heal-selectors/SKILL.md
[`seed-test-data`]: ../../.claude/skills/seed-test-data/SKILL.md
