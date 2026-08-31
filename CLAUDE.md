# CLAUDE.md

Guidance for Claude Code working in this repo. Keep it short - the depth lives in
[docs/](docs/README.md), and this file is the map plus the rules that are expensive
to break.

## What this is

**An agentic mobile E2E boilerplate.** WebdriverIO + Appium underneath; the point
is the loop on top of it:

```
build → run → explore → report → decide
```

A person sets direction and reviews. The tooling does the volume work: capture a
screen, declare it, write the spec, run the suite, triage what went red, explore
where the suite does not go, and report. Nothing here runs on a schedule and
nothing commits.

It drives **pre-built binaries** - it does not build the app. You do not need React
Native, Xcode projects or the app's source; you need a `.apk` or a Simulator `.app`.

⚠️ **This is the `demo` branch**: the framework wired to Sauce Labs' *My Demo App RN*
(`npm run setup` fetches it - the binary is never committed). It exists as a worked
example of every file, and it finds a real bug. The **`main`** branch is the same
framework with the demo stripped out - that is the one to adopt.

## Adopting this for another app - THREE FILES

| file | what it holds |
|---|---|
| [config/app.ts](config/app.ts) | ids, binaries, auth strategy, test-data provider |
| [test/pageobjects/app.contract.ts](test/pageobjects/app.contract.ts) | how the framework asks *your* app "are you ready / signed out", and how to sign out |
| [test/pageobjects/screens.ts](test/pageobjects/screens.ts) | the map generic passes walk - your screens and how to reach them |

Nothing else hardcodes an app id. If you find something that does, that is a bug.

## Commands

```bash
npm install                # postinstall applies patches/ - don't skip it
npm run setup              # fetch the demo app binary (add --ios for the Simulator build)

npm run wdio:android       # boots the emulator first, then runs
npm run wdio:ios           # PLATFORM=ios wdio run ./wdio.conf.ts
npm run wdio:android:debug # only tests tagged @debug in their title
npm run wdio:android:isolated  # fresh app install per spec file (fullReset)

npx wdio run ./wdio.conf.ts --spec test/specs/<name>.e2e.ts   # one spec
npm run typecheck          # tsc --noEmit (there is no separate lint script)

npm run android:boot       # / :kill / :status / :avd
npm run ios:boot
npm run device:status      # who holds the device - every wdio:*/explore:* script locks it
npm run report             # last run → reports/report-<platform>.html (self-contained)
npm run config:diff        # did a refactor change the resolved wdio config?

npm run capture:tree       # diff a live capture against the page objects
npm run explore:index -- search "<words>"   # is this finding already known?
npm run explore:android    # / :ios - run the exploratory charters
```

Run configuration comes from the shell: `PLATFORM`, `ISOLATED`, `SPEC_FILTER`,
`TIMEOUT_SCALE`, `IOS_APP_PATH`, `ANDROID_APP_PATH`, `IOS_DEVICE_NAME`.
**Secrets come from `.env`** and nowhere else - see
[docs/architecture/test-data.md](docs/architecture/test-data.md).

The `appium` wdio service starts and stops the Appium server - don't run `appium`
yourself.

## Where things are

```
config/app.ts             ⭐ the app under test - edit this first
wdio.conf.ts              the run: specs, capabilities, hooks
config/wdio/              the pieces it is assembled from
test/specs/               your suites - wdio builds the run by READING this dir
test/pageobjects/         Component trees, one per screen
  abstraction/component   THE ONE RULE lives here
  app.contract.ts         ⭐ the framework's seam into your app
  screens.ts              ⭐ the map for generic passes
test/support/             session recovery, timeouts, test data, the explore harness
test/exploratory/         charters (never part of a regression run)
requirements/             REQ-*.md - the test basis, in this repo's own format
utils/                    actionHelper (the spec API), actions, gestures, pageSource
config/                   app definition, env, the one Android device definition
scripts/                  emulator control, device lock, capture diffing, findings index
patches/                  patch-package fixes, applied on install
docs/                     everything below
```

## Read before you change anything

| you are about to | read |
|---|---|
| write a selector | [docs/architecture/page-objects.md](docs/architecture/page-objects.md) - and capture the screen first (`inspect-live-screen`) |
| add or fix a wait | [docs/architecture/waits.md](docs/architecture/waits.md) |
| touch a timeout, a retry, or anything slow | [docs/architecture/performance.md](docs/architecture/performance.md) |
| touch the fixture, or anything that deletes data | [docs/architecture/test-data.md](docs/architecture/test-data.md) |
| exclude a test | [docs/testing/suites.md](docs/testing/suites.md#exclusion-policy) |
| file a finding | [docs/testing/exploratory.md](docs/testing/exploratory.md#triage-is-not-optional) |
| work on CI | [docs/guides/ci.md](docs/guides/ci.md) - what a pipeline must provide |

Per-screen accessibility-tree oddities:
[docs/reference/app-quirks.md](docs/reference/app-quirks.md). Approaches already tried
and reverted: [docs/history/experiments.md](docs/history/experiments.md) - check it
before "improving" something that looks obviously improvable.

## The rules

Each was bought with a real failed run. They are not style preferences.

**Architecture**

1. **Specs never touch a selector or a raw `$()`.** They call `ActionHelper` with an
   alias path. Actions live in `utils/actions.ts` as free functions - don't add action
   methods to `Component`.
2. **THE ONE RULE: a child is looked up INSIDE its parent's element.** The declared
   tree must mirror the real accessibility tree. You may skip levels; you may not
   declare a sibling as a child. Apps are inconsistent about this, so check a live
   capture before nesting.
3. **Every React Native `<Modal>` is declared FLAT, at page level, with full ids.** A
   nested lookup does not reliably resolve the presented copy. Same for a drawer
   rendered over the screen.
4. **`maxInstances` stays 1.** One device can host one Appium session.

**Waits and timing**

5. **No `browser.pause()` in a spec.** Wait for the condition the pause stood in for.
6. **`isExisting` is a point-in-time read** - on an async screen, wait *on* it
   (`waitForExisting`), don't merely call it.
7. **Scale timeouts, don't rewrite them.** Every number was measured against a real
   failure on a dev machine; `TIMEOUT_SCALE` is the one knob.
8. **Never build a `timeoutMsg` eagerly.** An `await` inside one runs before the wait.
9. **Rank cost by driver calls, not by wall clock.** `[cost] N driver calls` is the
   only figure that means the same thing locally and in CI. Four figures is a bug.

**Evidence**

10. **Read the FIRST attempt's failure.** A spec-file retry of a non-idempotent suite
    manufactures failures that do not exist.
11. **Check the errorshot** (`errorShots/`) before re-diagnosing from an error
    message. For a hook failure, `afterHook` saves one too.
12. **Never size a ceiling or claim a speed-up from one CI run.** Hosted-agent
    timings vary >2x for identical work.
13. **Reproduce by hand before filing a finding**, and rule out the four framework
    artefacts that cause most false ones: Android's laid-out-only page source, a
    nested lookup into a modal, `visible="false"` on rendered nodes, and
    `autoAcceptAlerts` eating a native alert. A wrong entry in `APP_ISSUES.md` is
    worse than no entry - the file is the deliverable.

**Test health**

14. **Adapt the test if the test is at fault; never soften an assertion to make
    broken behaviour look fine.** Exclusion is the last step, and the finding stays in
    `APP_ISSUES.md`.
15. **Assert containment and relationships, not fixture sizes.** A fixture that grows
    should not break a suite that never mentions it.
16. **`itExceptInCI` is a last resort** - it hides a local-versus-CI divergence by
    construction. Keep the list at one or two entries.
17. **Anything a suite marks for deletion must carry the run's suffix.** Safety
    belongs in what a suite marks, not in the shared cleanup.

**Two named traps**

18. **A hosted login's fields go through `utils/webViewInput.ts`, never `setValue`.**
    Those screens accept a write and silently keep nothing. Values are **pasted**, not
    typed - don't "simplify" that back. Only relevant to `auth.strategy: "webview"`.
19. **Use `relaunchOurApp()`, never `browser.relaunchActiveApp()`.** The foreground
    app on a recovery path is not guaranteed to be ours.

## Skills

- `inspect-live-screen` - capture a screen's live accessibility tree. Use before
  writing any selector.
- `create-page-object` / `create-test` - add either, following this framework's
  conventions.
- `import-cases` - test cases in someone else's format (TestRail/Jira/Confluence
  export, a spreadsheet, a doc) → `requirements/REQ-*.md`, source ids kept.
- `automate-requirement` - a requirement or manual test case → a justified plan,
  checked against what already exists.
- `run-regression` - run the suite, stamp what tree it describes, triage, report.
- `report-run` - the last run → one self-contained HTML report (`npm run report`).
- `debug-test-failure` - triage a failure against known causes before guessing.
- `heal-selectors` - repair page objects after a new app build.
- `seed-test-data` - implement or use a `TestDataProvider`. Read it before touching
  anything that deletes data.
- `explore-app` / `cover-gap` - exploratory sessions, and turning a finding into
  coverage.

Subagents: **`regression-runner`** and **`screen-mapper`** (device-bound, one at a
time), **`failure-triage`** (one per failure, parallel, no device),
**`exploratory-tester`**, **`finding-triage`** and **`suite-auditor`** (read-only).
What each is for, and what the AI deliberately does not decide:
[docs/testing/agentic-workflow.md](docs/testing/agentic-workflow.md).

## Patches

`patches/` is applied automatically by `postinstall`. Both fix real, still-unfixed
upstream bugs; if you bump either package, re-verify and regenerate with
`npx patch-package <pkg>`.

- **`@wdio/appium-service`** - `_startAppium()` evaluates raw stderr chunks instead of
  buffering into complete lines, so Appium's harmless `dbug`-tagged "Creating hash file
  directory" line was misread as a fatal `Error: dbug` on every run. Don't try to fix
  this with `args.logLevel` instead - that was tried and it breaks startup detection.
- **`@wdio/utils`** - `testFrameworkFnWrapper` calls `JSON.stringify` on a thrown
  error inside its own catch block, so an error with a circular own property destroys
  its own failure report. Two full regressions produced no evidence at all before this.
