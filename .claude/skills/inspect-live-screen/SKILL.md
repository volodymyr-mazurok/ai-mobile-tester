---
name: inspect-live-screen
description: Capture the live accessibility tree, screenshot and testID inventory for a screen of the app under test on a real Simulator/Emulator. Use before writing or fixing any selector - never guess one from the app's source or from memory.
---

# Inspect a live screen

Guessing selectors is unreliable, and three things make it so in nearly every React
Native app: dotted testIDs imply a hierarchy the native accessibility tree often does
not have, Android's page source contains only what is currently LAID OUT, and a
hosted login page has no testIDs at all because its markup is not the app's to tag.
Always verify against the running app - never from the app's source, and never from
memory.

## ⚠️ Never put a diagnostic in `test/specs/`

`config/wdio/specOrder.ts` builds the run by **reading that directory** and taking
every `*.e2e.ts`. A throwaway `test/specs/_inspect.e2e.ts` therefore joins the next
regression. `test/exploratory/` exists precisely so it doesn't have to: put the
capture in a `*.charter.ts` there and run it with `wdio.explore.conf.ts`
(`npm run explore:ios` / `:android`).

That config spreads `wdio.conf.ts`, so a charter keeps the real
`onPrepare`/`onComplete` and gets the same seeded fixture a suite gets, torn down
afterwards - and it can never join a regression, because `orderedSpecs()` only
reads `test/specs/`.

## 1. Get a device up

```bash
npm run device:status            # is something already driving it?
npm run ios:boot                 # or: npm run android:boot
```

## 2. Write the capture

Use the exploratory harness rather than hand-rolling a dump - it writes the page
source, a screenshot and a sorted testID inventory per snapshot, and runs the tree
oracles for free.

⚠️ **`Settings` below stands in for YOUR page object or `screens.ts` entry.** Only
`actionHelper`, `timeouts`, `session` and `explore` are real paths on `main`;
`test/exploratory/sweep.charter.ts` is a working example of all of this.

```ts
// test/exploratory/inspect-<screen>.charter.ts
import * as fs from "fs";
import { browser } from "@wdio/globals";
import ActionHelper from "../../utils/actionHelper";
import Settings from "../pageobjects/settings.page";          // yours
import { waitForAppReadyOrRecover } from "../support/session";
import { longFlowTimeout, scaled } from "../support/timeouts";
import { inventory, smells, startSession } from "../support/explore";

describe("Inspect: Settings", function () {
  this.timeout(longFlowTimeout());

  it("captures the screen", async () => {
    const session = startSession("inspect-settings");
    await waitForAppReadyOrRecover();

    await session.step("open Settings", async () => {
      ActionHelper.setCurrentPage(Settings);
      await ActionHelper.click("Settings Tab");
      await ActionHelper.waitForDisplayed("Header Title", scaled(30_000));
      const snap = await session.snapshot("settings");
      fs.writeFileSync(`${session.dir}/inventory.txt`, inventory(snap));
      for (const o of smells(snap, await browser.getWindowSize())) session.observe(o);
    });

    session.finish();
  });
});
```

```bash
CHARTER=./test/exploratory/inspect-settings.charter.ts npm run explore:ios
CHARTER=./test/exploratory/inspect-settings.charter.ts npm run explore:android
```

Evidence lands in `.explore/inspect-settings-<platform>/` - `notes.md`, the `.xml`,
the `.png` (Read renders it), the `.ids.txt`, and your `inventory.txt`.

⚠️ **Capture BOTH platforms.** iOS keeps off-screen scroll content in the tree;
Android holds only what is laid out. A single-platform capture is how a page object
ends up correct on one and broken on the other.

⚠️ **Scroll and snapshot again** for anything below the fold, and snapshot with each
modal or sheet OPEN - a modal's subtree only exists while it is presented.

## 3. Diff it against the committed page objects

```bash
npm run capture:tree -- .explore/inspect-profile-ios
```

Prints what the app has that isn't declared, what's declared but wasn't captured, and
a paste-ready skeleton. Read its output rather than hand-diffing.

Two categories of "declared but not captured" are **expected, not drift**: a node
that only groups children, and a state-dependent child (a ticked checkbox has
`checkedIcon`, an unticked one `box` - never both).

Because ids are **composed** from a prefix, `grep settings.account.emailValue` finds
nothing in the repo. `capture:tree` is the only thing that will tell you the app
renamed something.

## 4. Read the ancestry, not just the ids

The capture's value is the **ancestor chain**, because a child is looked up INSIDE its
parent. Walk up from the element and note which *tagged* elements enclose it. Then
hand it to `create-page-object`.

Known per-screen oddities are already written down in
[docs/reference/app-quirks.md](../../../docs/reference/app-quirks.md) - check there
before concluding you have found something new.

## 5. Clean up

Delete a one-off charter once you have extracted what you need. `.explore/` is
gitignored scratch; a re-run overwrites its own directory.

## Notes

- **You probably do not need a WebView context switch, even for a hosted login.**
  Measured on a real one: the form was exposed in the NATIVE tree on both platforms -
  on Android as two `EditText`s distinguished only by their `hint`. `getContexts()`
  returned `NATIVE_APP` alone, because the app did not set `webviewDebuggingEnabled`,
  so there was no WEBVIEW context to switch to however long you polled. **Check
  `getContexts()` once** rather than assuming either way.
- **Getting to a signed-in state inside a capture**: `waitForAppReadyOrRecover()`
  (`test/support/session.ts`) waits for any resting state `app.contract.ts` declares
  and escalates to a relaunch, then a reinstall. If your app needs credentials typed
  first, put that in `signInForExploration()` in `screens.ts` so every charter shares
  one implementation.
