# Waits

**Specs contain zero static waits, and new ones shouldn't add any.** Every
`browser.pause()` that used to be there stood in for a condition; these helpers
wait for that condition instead.

## The helpers

| instead of | use | waits for |
|---|---|---|
| `pause(20000)` at the top of a spec | `waitForAppReadyOrRecover()` | the app settling into any of the resting states `app.contract.ts` declares |
| `pause(3000)` after a tab tap | `ActionHelper.waitForDisplayed(path)` | something the *destination* renders |
| `pause(5000)` before a collection assertion | `ActionHelper.waitForCount(path, min)` | the DATA, not the container - and returns the count |
| a blind `scroll("up", 4)` | `ActionHelper.scrollUntilDisplayed(path, direction)` | the target, checking before it swipes at all |
| a pause after tapping a checkbox | `ActionHelper.waitForChecked(path, state)` | the state to settle - and returns what it settled ON |
| sampling something that may not have mounted | `ActionHelper.waitForExisting(path, timeout?, msg?)` | the element itself, re-resolving the path each poll |

`appContract.waitForAppReady()`'s 60s ceiling exists because a genuine cold start
really is 20-30s+, worse on an Android emulator. Don't lower it; it costs nothing
when the app is quick. Call it through `waitForAppReadyOrRecover()`
(`test/support/session.ts`), which escalates to a relaunch and then a reinstall
rather than simply timing out.

`waitForChecked` returns rather than throws on purpose: a checkbox that never
flips should read as a failed assertion, not as a wait that ran out.

When a screen is also scrolled to a known position, **scroll first and wait
after** - "the top of the screen has rendered" is the precondition the tests
actually need, and a stronger check than either step alone.

## `isExisting` is a point-in-time read

**Rule 6: on an async screen it must be waited *on*, never merely called.** In the
predecessor project this produced four separate intermittent failures across two
spec files in one day, and every one read as flakiness:

| the wait that was there | what it actually proved |
|---|---|
| the screen's HEADER is displayed | the screen was pushed - the body still held a **spinner** |
| the header title EQUALS the expected name | the same thing again, at a call site the first fix did not cover |
| `getCount(rows) === 0` | the list is empty - **not** that the empty placeholder had mounted |
| the `Loader` has gone | the loader has gone - **not** that the native PDF view behind it had mounted |

The shape is always the same: something adjacent is waited for, then the thing
that matters is SAMPLED once, and the two are different moments. It passes whenever
the gap is short, which locally is nearly always - each of them passed in a
standalone run of the same spec minutes before failing in a full one.

**The fix is never a longer wait on the adjacent thing - it is to wait on the
element you are about to assert.** `waitForExisting` is the counterpart to
`waitForDisplayed` for anything that is on screen while reporting itself
not-displayed. Give it a `timeoutMsg` naming which state never arrived - built
lazily, per rule 8. It softens nothing: an element that genuinely never renders
still fails, and now says why instead of reporting whatever came next as broken.

**Grep `isExisting(...)).toBe(true)` first** when a new intermittent failure
appears; the odds are good it is this.

### What the class narrowed to

Sweeping every `isExisting` site is churn - rewriting assertions with no evidence
behind them. Auditing every site in that suite, the class turned out to be
**narrower than "any async screen"**, which is what makes not sweeping defensible:

> **A point-read of a NATIVE view immediately after a JS loading flag clears.**

A native view (a PDF renderer, a `<WebView>`, a map, a video, a chart) mounts at a
separate moment from the `loading` state that hides its spinner. A plain React
Native element renders in the SAME commit as the state that reveals it, so sampling
it is safe - which is why `isDisplayed(...)` on the very next branch of the same
test, after the very same loader wait, never flaked.

⚠️ **So the trigger to look again is a NEW NATIVE VIEW, not a new assertion.**
Anything added behind a loading flag joins this class on arrival; another `<Text>`
does not.

## Scrolling

`scrollUntilDisplayed`'s `maxSwipes` is a give-up bound, **not** a swipe count -
raising it costs nothing when the target appears early. `scroll()` is still right
for a deliberate nudge past the fold with no single element to aim at; its default
is **2**, and no call site should need more.

Two things it cannot do:

- **It only ever swipes ONE WAY**, so a loop over several targets has to visit them
  in SCREEN order. Going back up to something already scrolled past burns the budget
  and then throws. Either order the checks to match the screen, or scroll back to a
  landmark at the top between them.
- **A page fling can jump a small target entirely, in either direction.** `scroll()`
  is a full-page fling, and the check only happens *between* swipes - so a 22px
  control can go from below the fold to above it unseen. Measured on a toggle above
  a 98-row grid: 14 flings down missed it, and so did a 6-fling correction upward.
  The fix is two-phase - fling to a big landmark next to it, then creep with a
  quarter-screen pointer swipe. Raising `maxSwipes` does not help; it is a step-size
  problem, not a budget one.

`mobile: scroll` (iOS) and `mobile: scrollGesture` (Android) are **not**
interchangeable. UiAutomator2's `mobile: scroll` is a scroll-*to*-element command
and needs a target selector; the directional command is `mobile: scrollGesture`,
taking `left`/`top`/`width`/`height`, `direction` and `percent`. See
`utils/gestures.ts`.

## Dismissing the keyboard

**`ActionHelper.dismissKeyboard()` after typing, before tapping anything else.**
React Native's default `keyboardShouldPersistTaps="never"` means the first tap
outside a focused input is spent dismissing the keyboard - the button you aimed at
looks like it did nothing. On Android it is worse than cosmetic: while the IME owns
the focused window, UiAutomator2's page source stops reporting most of the screen,
so elements plainly on screen do not EXIST for a selector.

The helper is platform-split for a reason: Android gets `hideKeyboard()`, iOS gets
a deliberate tap outside, because XCUITest answers "Did not know how to dismiss the
keyboard" for most React Native inputs and on one run took WebDriverAgent down with
it. ⚠️ **A hosted login's pages may need a third mechanism again** - Android's BACK
key was the only thing that reliably closed the IME over one WebView.

## The pauses that stay

**Rule 5 is about SPECS.** A pause inside the framework, on a path where there is
genuinely nothing to poll, is a different thing - and `utils/webViewInput.ts` has
several. Its `900 * attempt` settle before a retry is waiting out a hosted login
page's on-blur re-render, which is the provider's and not observable from here.
`utils/gestures.ts`'s 800ms per swipe is scroll-animation settle, and its 600ms
after a keyboard dismissal is the keyboard's own animation. Each maps to a failure
that reproduces without it (see [authentication.md](authentication.md)).

The one that *was* safe to convert is waiting for a field to hold what was just
written: `fillWebViewField` polls the value back, and escalates through four
attempts, so a miss costs a retry rather than a failed test.

⚠️ **If you add one, it needs a comment naming the failure it prevents.** A pause
with no such comment is one nobody can ever safely remove.

## Don't assume where a screen starts

`noReset: true` means the app - and whatever scroll position a *previous* test or
spec run left it at - persists across brand-new Appium sessions, not just app
relaunches. If a test's assertions depend on scroll position, scroll there
explicitly first, up *and* down as needed.

A grid that does not quite fit above the fold at the top of the screen is the usual
case: scroll down slightly before asserting on its later rows, and remember that on
Android anything not laid out is not in the page source at all.
