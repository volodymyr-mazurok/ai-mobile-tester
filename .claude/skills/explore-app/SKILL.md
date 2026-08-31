---
name: explore-app
description: Run a charter-based exploratory testing session against the app under test - drive it somewhere the smoke suites do not go, record evidence, and triage what turns up into findings that are not already known. Use when asked to look for bugs, explore a screen or flow, or go beyond the regression suite.
---

# Explore the app

## What this is, and what it is not

A regression suite checks what the run seeded. That is the right shape for a
regression signal, and it is **structurally incapable of finding anything nobody
thought to assert** - `COVERAGE.md`'s "Does not cover" lists are that blind spot
written down.

A session here is the other half. You **drive the app and record what you see**.

- A charter **never asserts**. A red charter means the charter broke; a green one
  tells you nothing. The output is evidence, not a verdict.
- The deliverable is a **triaged finding**, not a list of observations. An
  untriaged dump is worse than nothing here, because this repo's findings files
  are read by the app team.
- **A wrong finding costs more than a missed one.** One finding was filed as an app
  race, written into `APP_ISSUES.md`, and had a test excluded for it - then one
  manual attempt on the device retired the whole entry. It was a selector reading
  Android's laid-out-only page source. Step 5 exists because of that.

## Step 0 - pick a charter and a timebox

Read `docs/findings/EXPLORATORY_SESSIONS.md`: the **Sessions** table says what has already been
explored (including sessions that found nothing - those count), and the
**backlog** is ranked by what a session can find that a spec cannot.

A charter is one sentence: *explore `<area>` with `<resource>` to discover
`<information>`*. Pick ONE. A session that wanders covers nothing.

⚠️ **If the answer is already known and merely unasserted, this is the wrong
skill** - that is a COVERAGE gap, and it goes straight to `cover-gap`.

## Step 1 - load the prior art BEFORE driving anything

```bash
npm run explore:index                       # counts: findings / known gaps / tests
npm run explore:index -- gaps <Screen>      # what COVERAGE.md already admits
npm run explore:index -- tests <spec>       # every it() title in that suite
```

Then read the `COVERAGE.md` section for the screen end to end, and skim
`APP_ISSUES.md` for the ids that touch it. Ten minutes here is what keeps the
session from re-reporting a known finding for the fourth time.

## Step 2 - write the charter

`test/exploratory/<charter>.charter.ts`, following `sweep.charter.ts`. The
harness is `test/support/explore.ts`:

| | |
|---|---|
| `startSession(name)` | an output dir under `.explore/`, notes written through as they happen |
| `session.step(label, fn)` | run a step, **swallow whatever it throws** - half a session's evidence beats a stack trace |
| `session.snapshot(label)` | page source + screenshot + id inventory, returned parsed |
| `smells(snap, window)` | every oracle the tree alone can answer - see `ORACLES.md` |
| `probe(session, label, action)` | do something, diff the tree, flag `dead-control` when **nothing moved** |
| `delta(a, b)` / `inventory(snap)` | what changed; every id grouped by prefix |

Rules that keep a charter honest:

- Reuse `signInForExploration()` (`screens.ts`) and the **page objects**. A charter that
  hand-rolls selectors is testing its own selectors.
- No `expect`. Wanting one means the finding is ready to be a spec.
- Charters are disposable. Keep the ones worth re-running each build; delete the
  one-offs once written up.

## Step 3 - run it

```bash
CHARTER=./test/exploratory/<charter>.charter.ts npm run explore:ios
CHARTER=./test/exploratory/<charter>.charter.ts npm run explore:android
```

⚠️ **A charter run pays for the whole fixture**, seeded before it and torn down
after it. Run the charters you mean to run in one go rather than one at a time in a
loop, and **never point a charter at an account other people depend on**.

⚠️ **Both platforms, always, before writing anything up.** Nearly every
false finding in this repo's history was a platform artefact read as an app
defect. If you can only run one, say so in the write-up.

## Step 4 - read the evidence

`.explore/<charter>-<platform>/`: `notes.md` (chronological), `observations.json`
(the candidates), and per snapshot an `.xml`, a `.png` and an `.ids.txt`.

**Read the screenshots.** Half of what looks like a missing element is a modal,
a keyboard, or the app still loading - the same rule `debug-test-failure` opens
with.

## Step 5 - TRIAGE, one candidate at a time

Nothing is a finding until it survives all five questions.

**1. Is it a framework artefact rather than an app behaviour?** These four
produce more false findings here than everything else combined:

- **Android's page source holds only what is LAID OUT.** "The element is absent"
  on Android means "not currently laid out" until proven otherwise. Scroll to it
  and re-snapshot.
- **`*.screen` nodes and sheet overlays report `visible="false"` while plainly on
  screen.** Never conclude anything from `visible` alone.
- **A nested lookup can fail for an element that is on screen** - every RN
  `<Modal>` is presented in its own hosting view, and a scroll container can be
  absent from Android's tree while its own children are in it. Check whether the
  CONTAINER resolves before concluding anything about the app.
- **`autoAcceptAlerts: true`** means a native alert is dismissed before anything
  can see it. "No confirmation appeared" may be the capability, not the app.

**2. Is it already known?**

```bash
npm run explore:index -- search "<the finding in your own words>"
```

Ranked hits across `APP_ISSUES.md`, `TESTID_IMPROVEMENTS.md`, `BUG_REPORTS.md`,
`COVERAGE.md`'s gaps and every `it()` title. ⚠️ **A miss is not proof of
novelty** - it searches words, and two people describe one defect differently.
Read the relevant section before writing a new entry.

**3. Does it reproduce BY HAND on the device?** This is rule 13, and it is
not optional for anything you intend to file. Drive it manually (`inspect-live-screen`
gets you a device and a live tree). It takes minutes, and a wrong entry in
`APP_ISSUES.md` is worse than no entry, because the whole file is the deliverable.

**4. Which is it?** The three destinations do not overlap:

| destination | what belongs there |
|---|---|
| `APP_ISSUES.md` | the app does the wrong thing for a **user**. Section A functional, section B testability-with-user-impact |
| `TESTID_IMPROVEMENTS.md` | the app works, but the way the tree is composed makes it needlessly hard to automate. Name the app-source file and line if you can |
| `COVERAGE.md` + `cover-gap` | the app is **right** and nothing checks it. Not a finding - a test |

**5. Does it matter?** Say who it hurts and when. "Inconsistent" is not an
impact; "the only copy of the amount is truncated, so the user cannot read it" is.

## Step 6 - write it up

- **One id per finding**, the next free number in that file's own sequence (`A1`,
  `B1`, `#1` in a fresh repo). Follow the surrounding entries' shape exactly: what was
  observed, **how to reproduce**, why it matters, which platforms, the date.
- **Name the platforms the evidence covers**, and only those. Scoping a finding
  wider than its evidence is how the predecessor project spent a fortnight excluding a working
  platform's coverage.
- If it changes what a suite should do, add the line to `COVERAGE.md` too.
- ⚠️ These files track **open** items. Anything fixed, withdrawn or accepted is
  **deleted**, not struck through.

## Step 7 - close the session

1. Add a row to `EXPLORATORY_SESSIONS.md` - **including a session that found
   nothing**. That row is what stops the next session repeating this one.
2. Hand every "the app is right and nothing checks it" item to **`cover-gap`**,
   which turns it into a spec without duplicating what already runs.
3. Delete a one-off charter; keep a re-runnable one.

## Report back like this

```
Charter:   <one sentence>   (ios + android, build <n>)
Explored:  <what was actually driven>
Findings:  <id> - <title>        NEW, repro'd by hand, both platforms
           <candidate>           duplicate of <existing id>
           <candidate>            test artefact (Android page source), withdrawn
Gaps:      2 handed to cover-gap - <one line each>
Evidence:  .explore/<charter>-ios/
```

Findings first, then what was ruled out and why. **Say what you did not get to** -
an area left unexplored is a result.
