---
name: automate-requirement
description: Turn a requirement, a Figma spec or a manual test case into a concrete plan for automating it in this framework - what to assert, what already covers it, what page-object and fixture work it needs, and where it goes. Use when handed something to automate, before writing any test.
---

# Automate a requirement

Input: a requirement, a spec, an acceptance criterion, a manual test case.
Output: **a plan** - a list of tests worth writing, each justified. Writing them is
`create-test`'s job; this decides *what* is worth writing and confirms it isn't
already there.

## 1. Turn the requirement into checkable claims

Break it into statements that can be true or false on a screen. "The user can manage
their contact preferences" is not checkable; "unticking every contact method is
refused with an inline error" is.

For each claim, write down **what would prove it false**. A claim with no failure mode
is not a test - it is a description.

## 2. Does it already exist?

```bash
npm run explore:index -- search "<the claim in your own words>"
npm run explore:index -- tests <spec>
npm run explore:index -- gaps <Screen>
```

Then read the suite's **Covers** list in `docs/findings/COVERAGE.md` and the
neighbouring `it()` bodies. Three ways a "new" test is really a duplicate:

- **The assertion is new but the path is not** - add it to the test that already
  navigates there rather than paying a second navigation.
- **It re-proves a precondition** - sign-in, the tab bar, the header. Every suite
  already establishes those.
- **It restates the fixture** - "there are four documents" is the fixture talking to
  itself. Assert what the app *derives* from it.

For each surviving claim, finish this sentence before it goes in the plan: **"this
fails when X breaks, and no existing test does."**

## 3. Check it against the app, not just the spec

⚠️ **Spec-versus-build divergence is DOCUMENTED, not asserted.** Where a build
knowingly differs from its design in small ways - a button label, a placeholder, a
missing back link - the test asserts **what the build does**, with the divergence
named in a comment. Hosted third-party pages diverge like this constantly. A suite
full of permanent red is not a regression signal. **Only a genuine FUNCTIONAL gap
gets a red test**, and it gets an `APP_ISSUES.md` entry with it.

So, before planning a test for behaviour you have not seen:

- search `docs/findings/APP_ISSUES.md` - it may be a known, open defect;
- capture the screen (`inspect-live-screen` / `screen-mapper`) and confirm the
  elements exist and are tagged;
- if the behaviour is simply absent, the deliverable is a **finding**, not a test.

## 4. Work out what it costs

For each planned test:

| | |
|---|---|
| **page object** | do the elements exist and resolve, on both platforms? |
| **fixture** | can the run's seeded fixture reach this state? |
| **placement** | an existing spec, or a new one? |
| **cost** | roughly how many driver calls - is a big collection involved? |

⚠️ **A fixture change can break a suite that never mentions it.** Seeding three
documents also generated three notifications and failed six Notifications tests.
Assert containment and relationships, never fixture sizes - and re-read every suite
that touches the same data.

Some states need a **second fixture** - an account with no data at all being the
usual one, since a fixture that seeds everything can never render an empty state.
That is a real piece of work: its own setup and teardown, and a spec-order decision.
Say so in the plan rather than discovering it mid-implementation.

## 5. Write the plan

```
Requirement: <one line>
Claims:      1. <claim>  → covered by <spec>::<test>          (no work)
             2. <claim>  → NEW test in <spec>                 (fails when …)
             3. <claim>  → NOT AUTOMATABLE: <why>             (finding? testability ask?)
Page object: <what needs adding, and whether it is captured yet>
Fixture:     <none | what changes, and which suites also read it>
Placement:   <spec file, and where in its order — and whether it is pre-auth>
Risks:       <known app issue, platform asymmetry, cost>
```

⚠️ **"Not automatable" is a legitimate outcome and must be said out loud.** The usual
causes: selected / checked / expanded state is style-only in React Native and often
exposed nowhere, `autoAcceptAlerts` dismisses a native alert before a test can see
it, and a download lands outside the accessibility tree entirely. A test that cannot
really observe the thing it claims to check is worse than no test.

## 6. Hand it off

`create-page-object` for anything missing, then `create-test`. Then update
`docs/findings/COVERAGE.md` - move each line from *Does not cover* to *Covers*, and
fix the screen's test count.
