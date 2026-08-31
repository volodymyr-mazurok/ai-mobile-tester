---
name: cover-gap
description: Turn an exploratory finding or a COVERAGE.md gap into real WebdriverIO/Appium coverage - a spec, a page-object change, or a fixture change - without duplicating what the suite already runs. Use after an exploratory session, or when asked to close a known coverage gap.
---

# Close a coverage gap

Input: something the app does that **nothing checks**. Usually from an
`explore-app` session, or straight from a `COVERAGE.md` "Does not cover" bullet.

Output: coverage that would **fail for a reason no existing test would fail
for**. That sentence is the whole quality bar - a test that overlaps an existing
one costs a run's time on every platform forever and detects nothing new.

> This framework is **WebdriverIO + Appium**, Mocha specs under `test/specs/`.
> Coverage means a spec here - not a unit test, and not a web suite elsewhere.

## Step 1 - is it coverage at all?

| the app is… | where it goes |
|---|---|
| **right**, and nothing checks it | here. Write the test |
| **wrong** | `APP_ISSUES.md` first. Then adapt the test if the TEST is at fault; **never soften an assertion to make broken behaviour look fine**. Only once adaptation has been tried and cannot work does it become `it.skip` + `[EXCLUDED <id>]` |
| right on a real device, impossible on a hosted agent | `itExceptInCI` + `[CI-EXCLUDED <id>]`, with an entry in `ciExclusions.ts` naming **what is different about CI**. Third resort, after fixing the test and after fixing its cost |
| not reachable with the current fixture | Step 4. That is a fixture change, and it has its own hazard |

## Step 2 - the overlap check, before writing anything

```bash
npm run explore:index -- tests <spec>      # every it() title in that suite
npm run explore:index -- gaps <Screen>     # what COVERAGE.md admits is missing
npm run explore:index -- search "<what you intend to assert>"
```

Then read the suite's **Covers** list in `COVERAGE.md` and the neighbouring
`it()` bodies. Three ways a "new" test is really a duplicate:

- **The assertion is new but the path is not.** If an existing test already
  navigates there and reads that element, add the assertion to it rather than
  paying a second navigation. A spec's cost is round-trips, not lines.
- **It re-proves a precondition.** Every suite already proves sign-in, the tab
  bar and the screen's header. Do not re-assert them.
- **It restates a fixture.** "There are four documents" is the fixture talking to
  itself. Assert what the app **derives** from the fixture.

Write the one-line justification down before you write the test: *this fails when
`<X>` breaks, and no existing test does.* If you cannot finish that sentence, the
gap is already covered.

## Step 3 - where it goes

- **Prefer an existing spec.** A new spec file costs a fresh session, a fresh
  launch and a place in the run order.
- **A new spec joins the run automatically** - `wdio.conf.ts` builds the run by
  READING `test/specs/`. Nothing to register, and nothing that can be forgotten.
- ⚠️ **SPEC ORDER IS LOAD-BEARING.** Authenticated specs run first so the run pays
  **one** sign-in; anything that signs OUT runs last. A new pre-auth spec must join
  `PRE_AUTH_SPECS` in `config/wdio/specOrder.ts`, not sit in the middle.
- ⚠️ **TEST ORDER MATTERS inside a suite whose writes change what its reads count.**
  Writes come last, and each puts back what it changed. Adding a write test anywhere
  but the end breaks the reads above it - and see rule 10 on what a retry then does.

## Step 4 - fixture changes, if the gap needs data

The fixture is `test/support/testData.ts`
(see the `seed-client` and `setup-test-data` skills).

⚠️ **ADDING TO THE FIXTURE BREAKS SUITES THAT NEVER MENTION IT.** Seeding three
documents also generated three notifications, and six Notifications tests failed
on `expect(1)` - nothing was wrong with the app or the seeding. So:

- **Assert containment and relationships, never fixture sizes.** Drive counts off
  `seededDocs.names.length`, never a literal `3`.
- After any fixture change, re-read every suite that reads the same data, not
  just the one you are working on.
- Some gaps need a **second fixture** - an account with no data at all is the usual
  one, because a fixture that seeds everything can never render an empty state. That
  is a real piece of work: its own setup, its own teardown, and a spec-order decision
  so the run does not pay a second sign-in. Decide it deliberately.

## Step 5 - page object first, if the selectors are missing

Use `create-page-object`, and hold to the four rules that cost real debugging
time here:

- **THE ONE RULE**: a child is looked up INSIDE its parent, so the declared tree
  must mirror the real one. Verify ancestry from a live capture
  (`inspect-live-screen`) - a sibling declared as a child type-checks and resolves
  to nothing.
- **Every RN `<Modal>` is declared FLAT at page level with full ids.** A nested
  lookup does not reliably resolve the presented copy.
- **Reading a field ACROSS rows needs its own row-spanning collection.** A
  collection with no `#N`/`#text` filter resolves to its **first member**, which
  silently defeats any sort or total assertion.
- Only four builders: `byTestId`, `byTestIdEnding` (inside a collection member
  only), `byRecordId`, and `rowField(prefix, tail)` for ONE field read across every
  row - which is also what makes `getTexts`/`getIds`/`getCount` cheap.

## Step 6 - write the test

Follow `create-test`. The additions that matter most for a NEW test today:

- **Specs contain zero `browser.pause()`.** `waitForDisplayed` / `waitForCount` /
  `waitForChecked` / `scrollUntilDisplayed` each wait for the actual condition.
- **Cost is round-trips.** Use `ActionHelper.getTexts` / `getIds` to read a
  collection - never a `getText()` per member. Never `#text in <collection>` over
  a large grid when the id is known.
- ⚠️ **Never build a `timeoutMsg` eagerly.** An `await` on the same line as
  `timeoutMsg` runs BEFORE the wait, reports pre-wait state, and can fail the
  test from inside the construction of its own error message. Read into a
  variable in the predicate and build the message in a `catch`.
- **Timeouts come from `test/support/timeouts.ts`** - `suiteTimeout()`, or
  `longFlowTimeout()` only for a suite that genuinely waits on a third party.
  Never a hard-coded CI-sized number.
- `isExisting` rather than `isDisplayed` when the element may be off-screen - and
  rule 6, wait *on* it rather than merely calling it.
- `ActionHelper.isChecked(...)` for a custom (non-native) checkbox. `isSelected()`
  tracks nothing that is not a genuine native control, and in React Native that is
  usually nothing at all.

## Step 7 - verify, then record

⚠️ **Do not run anything while another session is driving the device.** One
Simulator or emulator takes one Appium session; `maxInstances: 1` is a device
fact, not a preference. Check with the user first when in doubt.

```bash
npx tsc --noEmit
npx wdio run ./wdio.conf.ts --spec test/specs/<the-file>.e2e.ts     # ios
PLATFORM=android npx wdio run ./wdio.conf.ts --spec test/specs/<the-file>.e2e.ts
```

- **Both platforms.** A test verified on one is not evidence for the other.
- **Read the `[cost] N driver calls` line** the `afterTest` hook prints for your
  test. That number means the same thing locally and in CI, so it is what
  predicts whether the test survives the pipeline. **Four figures is a bug** -
  find the `#text in <collection>` or the per-member `getText()` behind it.
- **A failure is evidence.** If the new test goes red, work out whether the app
  or the test is at fault before touching either - and never read a `documents`
  failure from a spec-file retry, whose second attempt runs against a world its
  first attempt already changed.

Then record it, or the next audit re-finds the same gap:

1. **`COVERAGE.md`** - move the line from *Does not cover* to *Covers*, and fix
   the test count in the screen's heading.
2. **`EXPLORATORY_SESSIONS.md`** - if this came from a session, note that the gap
   is now closed.
3. **`APP_ISSUES.md`** - only if the work turned up something the app gets wrong.

> The findings files (`APP_ISSUES.md`, `TESTID_IMPROVEMENTS.md`, `BUG_REPORTS.md`,
> `COVERAGE.md`, `EXPLORATORY_SESSIONS.md`) live in **`docs/findings/`**. They are
> referred to by bare filename throughout this repo because they are identifiers;
> `npm run explore:index` prints full paths.
