---
name: create-test
description: Add a new WebdriverIO/Appium spec file to this framework, following its conventions (ActionHelper + page objects, the run's seeded data, real-device timing, sequential execution). Use when the user asks to write or add a test for a screen or flow.
---

# Create a test

## Before you write anything

- **The screen needs a page object with verified selectors.** If it doesn't have
  one, use `create-page-object` first - never a raw `$()` in a spec.
- **Check it isn't already covered.** `npm run explore:index -- tests <spec>` lists
  every `it()` title; `npm run explore:index -- gaps <Screen>` lists what
  `docs/findings/COVERAGE.md` admits is missing. A new test has to fail for a reason
  no existing test would fail for - if you can't finish that sentence, don't write it.
- **Read [docs/testing/suites.md](../../../docs/testing/suites.md)** for the spec
  order and the fixture's contract. If the test needs data it controls, the
  `seed-test-data` skill is the way.

## The shape of a spec

⚠️ **The imports below are the SHAPE, not files that exist on `main`.** Substitute
your own page object and your own aliases; only `actionHelper`, `timeouts` and
`session` are real paths. The `demo` branch has two working specs to copy from.

```ts
import { expect } from "@wdio/globals";
import ActionHelper from "../../utils/actionHelper";
import Settings from "../pageobjects/settings.page";      // yours
import { waitForAppReadyOrRecover } from "../support/session";
import { suiteTimeout } from "../support/timeouts";

describe("Settings", function () {
  this.timeout(suiteTimeout());

  before(async () => {
    await waitForAppReadyOrRecover();
  });

  beforeEach(async () => {
    ActionHelper.setCurrentPage(Settings);
    await ActionHelper.click("Settings Tab");
    await ActionHelper.waitForDisplayed("Account Section > Title");
    await ActionHelper.scroll("up", 3);      // scroll position persists between tests
  });

  it("shows the signed-in account's email", async () => {
    expect(await ActionHelper.getText("Account Section > Email"))
      .toBe("a@example.com");
  });
});
```

- File name `test/specs/<name>.e2e.ts`. **It joins the run automatically** -
  `config/wdio/specOrder.ts` builds the run by reading the directory.
- ⚠️ **A pre-auth spec** (one that deliberately signs out) must be added to
  `PRE_AUTH_SPECS` in `config/wdio/specOrder.ts`. Authenticated suites run first so
  the run pays **one** sign-in; a spec in the wrong group costs every later suite a
  full sign-in.

## Credentials and data

- **Credentials come from `.env`**, read with `requiredEnv()`
  (`config/env/requireEnv.ts`), never from a committed file. If your app's auth is a
  hosted WebView, rule 18 applies - values are PASTED via `utils/webViewInput.ts`.
- **Data comes from the run's `TestDataProvider`** (`test/support/testData.ts`),
  which `config/app.ts` names. The default seeds nothing and the suite asserts
  against whatever the app ships with - honest, and correct until you need more.
  Read the `seed-test-data` skill before implementing one.
- **Getting to a signed-in state**: `waitForAppReadyOrRecover()` from
  `test/support/session.ts` waits for any resting state `app.contract.ts` declares
  and escalates to a relaunch then a reinstall. `ensureSignedOut()` is its
  counterpart for a pre-auth spec.

⚠️ **Rule 15: assert relationships, not fixture sizes.** Drive a count off the
fixture's own length, never a literal `3`. A fixture that grows must not break a
suite that never mentions it - that lesson cost the predecessor project six
unrelated tests in one afternoon.

## Addressing elements

`ActionHelper` is the only thing a spec calls. Set the page, then use alias paths:

```
"General Section > Full Name"        walk into a child
"#Weekly in Toggles"                 the collection member containing that text
"#2 of Toggles"                      the member at that 1-based index
"#Weekly in Toggles > Checked Icon"  ...then into that member's children
```

Moving screen means another `setCurrentPage` - a statement, so it can't be inlined
into an `expect(...)`.

Reads: `getText`, `getValue`, `getAttribute`, `getTexts`, `getIds`, `getCount`,
`getBoundingBox`, `isDisplayed`, `isExisting`, `isEnabled`, `isChecked`.
Waits: `waitForDisplayed`, `waitForExisting`, `waitForCount`, `waitForChecked`,
`scrollUntilDisplayed`. Actions: `click`, `longPress`, `setValue`, `clearValue`,
`scroll`, `dismissKeyboard`.

- **`isChecked`, never `isSelected`.** `isSelected()` tracks nothing that is not a
  genuine native control, and a React Native checkbox is an ordinary view whose state
  is usually style-only. `isChecked` reads it off the rendered child instead.
- **`getTexts` / `getIds` to read a collection**, never a `getText()` per member.
  One page source instead of N round-trips.
- **A collection with no `#N` / `#text` filter resolves to its FIRST member.** To
  read a field across rows, the page object needs a row-spanning collection.

## Waits - rule 5 is absolute

**No `browser.pause()` in a spec.** Every pause has a replacement that waits for the
condition it stood in for:

| instead of | use |
|---|---|
| a pause after launch | `waitForAppReadyOrRecover()` (`test/support/session.ts`) |
| a pause after a tab tap | `waitForDisplayed(<something the destination renders>)` |
| a pause before reading a list | `waitForCount(path, min)` - the screen renders before its rows arrive |
| a pause after a checkbox tap | `waitForChecked(path, state)` - assert on what it returns |
| a blind `scroll("down", 4)` | `scrollUntilDisplayed(path, direction)` |

- **`isExisting` is a point-in-time read.** On an async screen, wait *on* it
  (`waitForExisting`), don't merely call it.
- **`scrollUntilDisplayed` only swipes ONE WAY**, so a loop over several targets must
  visit them in screen order.
- **Timeouts come from `test/support/timeouts.ts`**: `suiteTimeout()`, or
  `longFlowTimeout()` only when the suite genuinely waits on a third party (a first
  login, a confirmation email, a connectivity drop). Never a hard-coded CI number -
  rule 7, `TIMEOUT_SCALE` is the one knob.
- ⚠️ **Never build a `timeoutMsg` eagerly.** An `await` on the same line as
  `timeoutMsg` runs *before* the wait: it costs an extra read, reports pre-wait
  state, and can fail the test from inside the construction of its own error message.
  Read into a variable in the predicate, build the message in a `catch`.

## Two named traps

- **A hosted login's fields go through `fillWebViewField()` (`utils/webViewInput.ts`),
  never `setValue`.** Those screens accept a write and silently keep nothing. Values
  are **pasted**, not typed - rule 18, and see
  [docs/architecture/authentication.md](../../../docs/architecture/authentication.md).
- **`relaunchOurApp()`, never `browser.relaunchActiveApp()`.** The foreground app on
  a recovery path is not guaranteed to be ours.

## Cost - a test's price is its round-trip count

`afterTest` prints `[cost] N driver calls | <title>`. That number means the same
thing on a dev machine and a CI agent, so it is what predicts whether a test survives
the pipeline. **Four figures is a bug** - look for a `#text in <collection>` over a
large grid, or a `getText()` per member. See
[docs/architecture/performance.md](../../../docs/architecture/performance.md).

## Running it

```bash
npx wdio run ./wdio.conf.ts --spec test/specs/your-new-spec.e2e.ts    # ios
PLATFORM=android npx wdio run ./wdio.conf.ts --spec test/specs/your-new-spec.e2e.ts
```

**Both platforms.** A test verified on one is not evidence for the other - Android's
page source contains only what is currently laid out, which is the single most common
cause of a spec that passes on iOS and fails on Android.

`maxInstances` stays `1`, and the npm scripts take a device lock - `npm run
device:status` tells you who is holding it.

## If the new test goes red

Work out whether the app or the test is at fault before touching either
(`debug-test-failure`). **Never soften an assertion to make broken behaviour look
fine** - adapt the test if the test is wrong; if the app is wrong, the finding goes
to `docs/findings/APP_ISSUES.md` and exclusion is the last step, not the first.
