# Experiments - tried, and reverted

Every entry is something that looked obviously right, was implemented, and made
things worse. They are here so the next person does not spend the same day on it.

> ⚠️ **Read this before "simplifying" anything in the list.** Each one still looks
> like an improvement. That is precisely why it is written down.

---

## Fixing the Appium-service log noise with `args.logLevel`

**Looked like** `patches/@wdio+appium-service` is a big hammer for a log-parsing bug.
Appium takes a `logLevel`, so just turn the `dbug` lines off and drop the patch.

**Actually** the service detects a successful startup *by reading Appium's stdout for
a specific line*. Suppressing log output suppresses that line too, so the service
never concludes Appium has started and the run hangs at session creation. The patch
buffers stderr into complete lines instead, which is the real bug.

---

## `browser.relaunchActiveApp()` instead of `relaunchOurApp()`

**Looked like** the WebdriverIO built-in does exactly the same thing with less code.

**Actually** it restarts the **active** app - and on the paths that need a relaunch,
the active app is frequently not yours. A fresh Android install leaves the
`POST_NOTIFICATIONS` dialog in front, so the "relaunch" resolved
`com.google.android.permissioncontroller` and the hook died with *"Unable to resolve
the launchable activity"*. Took out two spec files' `before all` hooks, 0 tests each.

It was then re-introduced at one call site with the caveat "fine here, our app is
already in front" - and a later build disproved that too. The hooks that run **after
a failure** run precisely when the foreground app is unknown. Rule 19.

---

## Deferring spec-file retries

**Looked like** `specFileRetriesDeferred: true` is the sensible default - retry at the
end, let the rest of the suite get on with it.

**Actually** spec order is load-bearing when suites share a session. A deferred retry
of an authenticated spec lands *after* the pre-auth specs have signed the app out, so
it retries into a state it was never written for. Immediate retry also health-checks
the driver on session creation, which is most of what the retry was for.

---

## Building `timeoutMsg` as a template that reads the screen

**Looked like** a failure message saying what *was* on screen beats one saying what
wasn't.

**Actually** the argument is evaluated **before** `waitUntil` runs, not on failure. So
the `await` inside it executes first - reading the screen before the wait has had a
chance to change it - and the message describes a moment that is never the failing
one. It also silently doubles the cost of every wait. Rule 8.

---

## Reading only `resource-id` as the element id

**Looked like** React Native's `testID` becomes `resource-id` on Android. One
attribute, one rule.

**Actually** that is only true for `testID`. An app that tags with
`accessibilityLabel` puts everything on `content-desc` instead, and both are common.
Against such an app the harness reported **`0 testIDs` on every screen**, which turned
every text node into an `untagged-text` finding (271 of them in one sweep) and made a
working sort control report as a dead control.

Now `byTestId()`, `utils/pageSource.ts` and `test/support/explore.ts` all resolve an
id from `name` → `resource-id` → `content-desc`, in that order, and all three must
stay in step. `content-desc` is a *text* source only when it is not already the id.

---

## Filtering ids by shape on both platforms

**Looked like** the app's ids have a recognisable shape, so a regex separates real
ids from noise everywhere.

**Actually** the noise only exists on **iOS**, where `@name` falls back to an
element's visible label when it has no accessibility identifier. On Android
`resource-id` and `content-desc` are explicit and never fall back, so every non-empty
id is genuine - and filtering by shape there just discards them. The heuristic is now
iOS-only and the pattern is per-app (`iosTestIdPattern` in `config/app.ts`).

---

## Modelling every screen as reachable the same way

**Looked like** the demo app hangs everything off a navigation drawer, so one
`DrawerScreen` class covers the map.

**Actually** its Cart is reached from a badge in the header and has no drawer entry
at all. Assuming otherwise meant *guessing* a `menu item cart` id - and the very
first sweep reported it as a step failure. The framework's own rule, applied to the
framework: capture the screen, never guess the selector. `open()` is now per-screen.
