---
name: debug-test-failure
description: Triage a failing or flaky WebdriverIO/Appium test in this framework against its known causes before guessing. Use when a test fails and the cause isn't obvious from the error message.
---

# Debug a test failure

## 0. Get the real error first

- **Open the errorshot.** `errorShots/<timestamp>-<platform>-<test>.png`, saved by
  `afterTest` - and by `afterHook`, so a hook failure has one too. Half of what looks
  like a broken selector is a modal, a keyboard, or the app still loading.
- ⚠️ **Read the FIRST attempt's failure**, from the run's STDOUT. `specFileRetries: 1`
  means a retry **overwrites its own first attempt's XML** (same cid, same filename),
  and a retry of a **non-idempotent** spec runs against a world its own first attempt
  changed - anything it created and could not put back is still there. One CI run's
  report contained two failures that did not exist.
- **A thrown error can no longer destroy its own report** (`patches/@wdio+utils`), so
  if you see `Converting circular structure to JSON`, the patch didn't apply -
  `npm ci` and check `postinstall` ran.

## 1. Rule out the environment before the code

1. **Another session on the device.** `npm run device:status`. Two Appium sessions on
   one Simulator interleave rather than error, and the failures read exactly like
   selector bugs. If the lock says free but tests behave impossibly, check for an
   un-locked run (`pgrep -fl wdio`, something listening on :4723).
2. **The run config changed.** After any refactor of `wdio.conf.ts` or `config/wdio/*`,
   `npm run config:diff` says whether the resolved config still matches the last
   commit's - capabilities, spec list, exclusions, timeouts, retries.
3. **A stale or poisoned app.** A blank screen that never reaches any of
   `app.contract.ts`'s resting states is usually a session holding a token for an
   identity that no longer exists - not a slow launch. `waitForAppReadyOrRecover()`
   escalates relaunch → reinstall by itself; if you are driving by hand,
   `ISOLATED=true` guarantees the slate.
4. **The wrong account is signed in.** A sign-in helper should assert the screen
   greeting names the run's seeded data precisely because "a session exists" is not "our
   session exists" - a stale one silently reads someone else's data.

## 2. The four artefacts that cause most false diagnoses

In this order - it's the order of how often each one has fooled someone here.

1. **Android's page source contains only what is currently LAID OUT.** "The element is
   absent" means "not laid out" until proven otherwise. Scroll to it and re-read. This
   one mechanism was behind four separate failures in a single day, including the
   one finding that had to be withdrawn.
2. **A nested lookup into a modal fails for an element plainly on screen.** Every RN
   `<Modal>` is presented in its own hosting view. Check whether the *container*
   resolves at all before concluding anything about the app.
3. **`visible="false"` on rendered nodes.** `*.screen` wrappers, sheet overlays and
   everything inside the in-chat document preview report not-displayed while
   unmistakably on screen. Use `isExisting` / `waitForExisting`, not `isDisplayed`.
4. **`autoAcceptAlerts: true` eats native alerts** before a test can see them. "No
   confirmation appeared" may be the config, not the app.

Also: **`isSelected()` tracks nothing that is not a genuine native control**, and in
React Native selected state is usually style-only. Read it off the `checkedIcon` /
`box` child via `ActionHelper.isChecked` instead.

## 3. Then the test-side causes

- **A wait that isn't one.** `isExisting` is a point-in-time read; on an async screen
  it has to be waited *on*. And a wait whose single iteration costs longer than its
  own timeout is a fixed sleep wearing a wait's clothes - that is exactly how three
  grid tests passed for the wrong reason and then failed when the call got faster.
- **An eager `timeoutMsg`.** An `await` on the same line runs before the wait, reports
  pre-wait state, and can throw from inside the construction of its own error message.
- **Cost, not correctness.** Check the `[cost] N driver calls` line for the test.
  Four figures is a bug: a `#text in <collection>` over a large grid, or a `getText()`
  per member. A test can fail purely by being too slow for its ceiling -
  [docs/architecture/performance.md](../../../docs/architecture/performance.md).
- **State from the previous test.** Scroll position persists; a detail sheet left open
  by a failing test hides the tab bar and cascades. `afterTest` relaunches the app
  after a failure for this reason - if a cascade still happens, the suite's
  `beforeEach` isn't re-establishing enough.
- **A hosted-login field written with `setValue`.** Those screens accept a write and
  keep nothing. Use `fillWebViewField()` from `utils/webViewInput.ts`. Rule 18.
- **Platform asymmetry.** A selector confirmed on one platform is not evidence for the
  other. Re-check the failing platform against a live capture.

## 4. Timing, and what is NOT a timing fix

Timeouts are measured dev-machine numbers scaled by `TIMEOUT_SCALE`. **Scale, don't
rewrite** - and never size a ceiling from one CI run, since hosted-agent timings vary
more than 2x for identical work. Adding a `pause` is not a fix; find the condition.

## 5. If it's genuinely new

Reproduce it, fix the root cause, and leave a comment explaining what happened and
why the fix works - the way `utils/webViewInput.ts` documents each of its settles.
Silent workarounds move the failure somewhere else.

If the **app** is at fault: reproduce **by hand** before filing anything, check
`npm run explore:index -- search "<words>"` for a duplicate, and follow
[docs/testing/exploratory.md](../../../docs/testing/exploratory.md#triage-is-not-optional).
Adapt the test if the test is wrong; **never soften an assertion to make broken
behaviour look fine**. Exclusion is the last step, and the finding stays in
`docs/findings/APP_ISSUES.md`.
