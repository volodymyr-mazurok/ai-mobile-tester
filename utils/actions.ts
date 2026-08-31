import { browser } from "@wdio/globals";
import { Component, byTestId, type IdPattern } from "../test/pageobjects/abstraction/component";
import { scroll } from "./gestures";
import { matchPattern } from "./pageSource";
// ⚠️ Every DEFAULT timeout below is scaled - see the note on waitForChecked.
import { scaled } from "../test/support/timeouts";

// The actions, written once, as free functions over "a component + a path".
//
// They live here rather than on Component so there is exactly ONE action API:
// ActionHelper wraps these with the current page, and a page object's own flow
// method (a LoginPage's `signIn`) calls them directly with `this`. Putting them
// on Component would mean two ways to click something; putting them only on
// ActionHelper would make a page object import its own importer.

export async function click(root: Component, path: string): Promise<void> {
  const el = await root.find(path);
  await el.waitForDisplayed();
  await el.click();
}

/**
 * Press and hold. The two platforms have entirely different commands for it -
 * XCUITest takes seconds and UiAutomator2 milliseconds - so the duration is
 * normalised here rather than at every call site.
 *
 * Reach for it where a screen offers a context menu with no visible affordance -
 * a long press on a list row is the usual case.
 */
export async function longPress(
  root: Component,
  path: string,
  ms = 1500,
): Promise<void> {
  const el = await root.find(path);
  await el.waitForDisplayed();
  const elementId = (el as unknown as { elementId: string }).elementId;
  if (browser.isIOS) {
    await browser.execute("mobile: touchAndHold", { elementId, duration: ms / 1000 });
  } else {
    await browser.execute("mobile: longClickGesture", { elementId, duration: ms });
  }
}

export async function setValue(root: Component, path: string, value: string): Promise<void> {
  const el = await root.find(path);
  await el.waitForDisplayed();
  await el.setValue(value);
}

/**
 * Empty an input.
 *
 * ⚠️ FOR AN IN-APP FIELD ONLY - NEVER FOR A HOSTED LOGIN'S PAGES. `clearValue()` BLURS
 * the field, and on those WebViews that fires the provider's on-blur re-render, which lands
 * while the next `setValue` is still typing. See
 * docs/architecture/authentication.md; utils/webViewInput.ts is the only thing that
 * should be writing there.
 *
 * `setValue` alone is not a reliable substitute on a React Native controlled input -
 * it APPENDS. A search test that typed twice without clearing looked for
 * "zzfoozzbar" and correctly found nothing.
 */
export async function clearValue(root: Component, path: string): Promise<void> {
  const el = await root.find(path);
  await el.waitForDisplayed();
  await el.clearValue();
}

/**
 * The element's visible text.
 *
 * On ANDROID this falls back to `content-desc` when `text` is empty, because
 * React Native splits the two across a parent and a child: a touchable is a
 * `ViewGroup` carrying `content-desc="Refresh"` with a `TextView` inside it
 * carrying `text="Refresh"`. A selector that has to point at the touchable (so
 * it can be clicked) therefore reads back "" for text that is plainly on
 * screen - which is exactly what iOS's @name/label fallback gives you for
 * free, and what makes the same assertion work on both platforms.
 *
 * Confirmed live on both a link and a button whose touchable carried the label
 * while the text sat on a child.
 */
export async function getText(root: Component, path: string): Promise<string> {
  const el = await root.find(path);
  await el.waitForDisplayed();
  const text = await el.getText();
  if (text || browser.isIOS) return text;
  const label = await el.getAttribute("content-desc");
  // UiAutomator2 returns the STRING "null" for an unset attribute.
  return !label || label === "null" ? "" : label;
}

/**
 * The current value of an input. getValue is Appium-only and WebdriverIO widens
 * it to `unknown`, so it is narrowed here rather than at every caller.
 */
export async function getValue(root: Component, path: string): Promise<string> {
  const el = await root.find(path);
  await el.waitForDisplayed();
  return (await el.getValue()) as string;
}

/**
 * A raw platform attribute, for the handful of things that aren't text, a
 * value or a state - e.g. Android's `password="true"` on a masked EditText,
 * which is the only way to prove that field is masked on that platform (iOS
 * says so by being an XCUIElementTypeSecureTextField instead). Returns null
 * when the attribute isn't set.
 */
export async function getAttribute(
  root: Component,
  path: string,
  name: string,
): Promise<string | null> {
  const value = await (await root.find(path)).getAttribute(name);
  // UiAutomator2 answers with the four-character STRING "null" for an
  // attribute that isn't set, not with an absent value - so an unguarded
  // caller ends up asserting against "null" (caught live reading `content-desc`
  // off an untagged input). Normalise it here, once.
  return value === "null" ? null : value;
}

/** Whether the element is on screen right now - does not wait. */
export async function isDisplayed(root: Component, path: string): Promise<boolean> {
  return (await root.find(path)).isDisplayed();
}

/** Whether the element is in the tree at all - does not wait. */
export async function isExisting(root: Component, path: string): Promise<boolean> {
  return (await root.find(path)).isExisting();
}

/**
 * Whether the element accepts interaction.
 *
 * ⚠️ UNLIKE `isChecked`, THIS DOES WORK ON A CUSTOM CHECKBOX VIEW. Confirmed
 * live: a preference row the account had no value on file for rendered with
 * `enabled="false"` while still existing, still being displayed, and still
 * reporting an unticked state - so `isEnabled` was the only way to assert a
 * "disabled when there is nothing to toggle" rule at all.
 */
export async function isEnabled(root: Component, path: string): Promise<boolean> {
  return (await root.find(path)).isEnabled();
}

/**
 * Whether a CUSTOM (non-native) checkbox is ticked.
 *
 * ⚠️ EDIT THIS IF YOUR APP RENDERS STATE DIFFERENTLY. React Native checkboxes
 * are ordinary views, not native controls, so `isSelected()` does NOT track them
 * - confirmed live, it never flips. The convention this assumes is the common
 * one: a `checkedIcon` child rendered when ticked and a `box` child when not, so
 * which of the two EXISTS is the state. That is a property of an app, not of any
 * one test, which is why it lives here rather than being hand-assembled from a
 * string in every spec:
 *
 *   await ActionHelper.isChecked("Notifications Section > #Weekly in Toggles")
 *
 * Uses isExisting, not isDisplayed - a row can be ticked while sitting just
 * off-screen.
 */
export async function isChecked(root: Component, path: string): Promise<boolean> {
  return isExisting(root, `${path} > Checked Icon`);
}

/**
 * Wait for a custom checkbox to reach `state`, and return what it actually
 * settled on. Toggling one usually round-trips to a server, so polling beats
 * guessing at a duration.
 *
 * Deliberately does NOT throw on timeout: it returns the final observed state
 * so the caller's `expect` is what reports a genuine failure. A checkbox that
 * never flips should read as a failed assertion, not as a wait that ran out.
 */
export async function waitForChecked(
  root: Component,
  path: string,
  state: boolean,
  // ⚠️ SCALED, and evaluated per call rather than once at module load - a JS
  // default parameter runs on every invocation, so this reads TIMEOUT_SCALE at
  // call time exactly like every other scaled() site. A raw 10000 here gave a
  // hosted agent a dev-machine budget for a state change that is one of the
  // slowest things this framework waits on.
  timeout = scaled(10000),
): Promise<boolean> {
  try {
    await browser.waitUntil(async () => (await isChecked(root, path)) === state, {
      timeout,
      interval: 250,
    });
  } catch {
    /* fall through - the caller asserts on what we return */
  }
  return isChecked(root, path);
}

/**
 * Whether a NATIVE checkbox/switch is ticked - iOS reports a switch as "0"/"1"
 * and Android uses the `checked` attribute; this normalises both. It does NOT
 * work on a custom React Native view that merely looks like a checkbox -
 * confirmed live, those never flip it. For those use `isChecked` above, which
 * reads the state off the rendered child instead.
 */
export async function isSelected(root: Component, path: string): Promise<boolean> {
  return (await root.find(path)).isSelected();
}

/**
 * Wait explicitly. With no timeout it uses wdio.conf.ts's `waitforTimeout`,
 * which is the same budget every other action here waits on - pass one only
 * when this particular element is genuinely slower than the rest.
 */
export async function waitForDisplayed(
  root: Component,
  path: string,
  timeout?: number,
): Promise<void> {
  await (await root.find(path)).waitForDisplayed(timeout ? { timeout } : undefined);
}

/**
 * Wait for an element to EXIST. The counterpart to waitForDisplayed, for the many
 * things that are on screen while reporting themselves not-displayed - modal
 * children, sheet overlays, a screen's own root node.
 *
 * ⚠️ RULE 6: USE THIS RATHER THAN SAMPLING `isExisting`. Sampling it cost four
 * separate intermittent failures across two spec files: each had a wait in front of
 * it, and each waited on the WRONG THING - the screen's header, the row count
 * reaching zero, the loader going away - all of which happen a beat before the
 * asserted element mounts. Three of the four had errorshots showing a spinner. See
 * docs/architecture/waits.md.
 *
 * It re-resolves the path on every poll rather than holding one element reference,
 * which is what makes it safe for `#text in collection` paths and for Android, whose
 * page source only holds what is currently laid out.
 *
 * Softens nothing: an element that never appears still fails, with a message naming
 * it rather than reporting whatever came next as broken.
 */
export async function waitForExisting(
  root: Component,
  path: string,
  timeout?: number,
  timeoutMsg?: string,
): Promise<void> {
  await browser.waitUntil(() => isExisting(root, path).catch(() => false), {
    ...(timeout ? { timeout } : {}),
    interval: 500,
    timeoutMsg: timeoutMsg ?? `"${path}" never appeared in the tree.`,
  });
}

export async function getBoundingBox(root: Component, path: string) {
  const el = await root.find(path);
  await el.waitForDisplayed();
  const [location, size] = [await el.getLocation(), await el.getSize()];
  return { x: location.x, y: location.y, width: size.width, height: size.height };
}

/**
 * How many elements a collection path matches - from ONE page source where the
 * selector allows it, exactly like `getTexts` and `getIds` below.
 *
 * ⚠️ THE FAST PATH MATTERS MOST HERE, because this is the most-POLLED of the three:
 * every `waitUntil(() => getCount(...) > n)` and every `waitForCount` counts in a
 * loop by definition. A scoped `$$` is not merely slower than a root one, it is a
 * different order of magnitude - one 98-row collection measured **56.37 s/call
 * scoped against 0.66s from the root**, 62 minutes of a 234-minute run in a single
 * selector. XCUITest re-snapshots the *subtree* for an element-scoped search, so
 * the price scales with the collection it is scoped to; a page source is one
 * snapshot however the question is phrased.
 *
 * ⚠️ AND A SLOW CALL CAN BE LOAD-BEARING - read this before touching the waits
 * around one. A helper polled this inside a 45s budget, which a single 56s call
 * could only answer once, after the list had rendered. Making the call honest
 * turned that accidental fixed sleep into the timeout it always should have been,
 * and failed three tests until the waits were sized properly. Fix the wait first,
 * then the cost.
 *
 * `getTexts`/`getIds` were never affected - they read once rather than polling. The
 * blind spot throughout is `[cost]`: a scoped `$$` is ONE driver call, so the two
 * most expensive tests of that run reported 195 and 165 calls while taking 15
 * minutes each. Rule 9 ranks by calls; this is the one case where it under-reads,
 * and the Appium log by endpoint is what settles it.
 */
export async function getCount(root: Component, path: string): Promise<number> {
  const pattern = fastPattern(root, path);
  if (pattern) return (await matchPattern(pattern)).length;

  return (await root.findAll(path)).length;
}

/**
 * The text of EVERY member of a collection, in document order - in ONE round-trip
 * where the selector allows it.
 *
 * Why this is not findAll + getText per member
 *
 * The obvious loop:
 *
 *     for (const el of await ActionHelper.findAll(path)) texts.push(await el.getText());
 *
 * and it costs ONE ROUND-TRIP PER MEMBER. iOS re-snapshots the whole element
 * hierarchy for every query, so each costs with the size of the tree rather than
 * with what was asked for: ~50ms on a dev machine, ~3s on a hosted CI agent.
 * Over a 98-row collection measured on a real app that is ~5 minutes for one
 * read. One CI run paid it five times over (684-1188s per test, three of them
 * through a 900s Mocha ceiling) and finished 3 of 9 iOS suites inside the step
 * limit - while passing locally in seconds, on the same commit, against the same
 * fixture. Only the latency differed.
 *
 * So when the collection's selector knows its ID SHAPE (`byRecordId` and
 * `rowField` both record one), the whole answer comes out of a single page
 * source. Otherwise this falls back to the per-element route, which is always
 * correct - a caller never has to know which happened.
 *
 * ⚠️ IT RETURNS "" FOR A MEMBER SHOWING NO TEXT, and keeps it, exactly as the
 * loop did. Callers filter falsy values themselves; dropping them here would
 * silently change every count and every sort assertion that reads a list.
 */
export async function getTexts(root: Component, path: string): Promise<string[]> {
  const pattern = fastPattern(root, path);
  if (pattern) return (await matchPattern(pattern)).map((node) => node.text);

  const found = await root.findAll(path);
  const texts: string[] = [];
  for (const element of found) texts.push((await element.getText()) ?? "");
  return texts;
}

/**
 * The runtime testID of every member of a collection - what a count has to
 * deduplicate on when it walks a scrolling list.
 *
 * Summing per-screenful counts double-counts every element a swipe leaves on
 * screen, and a Set of TEXTS collapses two rows that legitimately display the same
 * string (two rows both reading "£500.00"). An id is exact, and one page source
 * holds all of them - the alternative is a `getAttribute()` per member, at the same
 * cost `getTexts` documents above.
 */
export async function getIds(root: Component, path: string): Promise<string[]> {
  const pattern = fastPattern(root, path);
  if (pattern) return (await matchPattern(pattern)).map((node) => node.id);

  const attribute = browser.isIOS ? "name" : "resource-id";
  const ids: string[] = [];
  for (const element of await root.findAll(path))
    ids.push((await element.getAttribute(attribute).catch(() => "")) ?? "");
  return ids.filter(Boolean);
}

/**
 * The id shape `path` matches, or undefined when it has to be read per element.
 *
 * ⚠️ A FILTERED PATH IS NEVER FAST-PATHED. `#2 of Rows` and `#Weekly in
 * Toggles` select among members at runtime, which is a different question
 * from "what does this collection match" - and the point of reading these
 * collections at all is to get every member.
 */
function fastPattern(root: Component, path: string): IdPattern | undefined {
  if (Component.isFiltered(path)) return undefined;
  const definition = root.definitionFor(path);
  return definition.isCollection ? definition.selector?.idPattern : undefined;
}

/**
 * Swipe until `path` is on screen, then stop.
 *
 * This replaces the blind `scroll("up", 4)` / `scroll("down", 4)` calls that
 * guessed a swipe count big enough to cover the worst case. It checks BEFORE
 * swiping at all, so the common case (already where we need to be) costs zero
 * swipes and zero animation settle, and it stops the moment the target shows
 * rather than always paying the worst case. `maxSwipes` is a give-up bound,
 * not a swipe count - raising it costs nothing when the target appears early.
 */
export async function scrollUntilDisplayed(
  root: Component,
  path: string,
  direction: "up" | "down",
  maxSwipes = 4,
): Promise<void> {
  const visible = async () => {
    try {
      return await isDisplayed(root, path);
    } catch {
      // A collection row addressed by text throws until it renders - that's
      // "not on screen yet", not a broken path.
      return false;
    }
  };

  if (await visible()) return;

  // Ask the driver to scroll before swiping by hand.
  // The swipe ladder below costs TWO round-trips per step - a swipe and a visibility
  // check - and on iOS each re-snapshots the whole hierarchy. One CI run priced it:
  // a single spec took 62.6 of a 147-minute run, and its three grid tests spent
  // nearly all of it here.
  //
  // XCUITest has `mobile: scrollToElement`, which takes an element id and scrolls
  // its container until it is visible - ONE call, and it works with the path this
  // framework already resolved, off-screen elements included (XCUITest keeps them
  // in the tree). UiAutomator2 has `mobile: scroll` with a strategy/selector,
  // which is a UiScrollable search and finds rows Android's page source does not
  // even contain yet. Both names verified against the installed drivers'
  // execute-method-map, not assumed.
  //
  // ⚠️ BEST-EFFORT, AND THE LADDER STAYS. A native scroll cannot express "creep a
  // quarter screen", it needs a container that is genuinely scrollable, and on
  // Android it needs a resolvable id - so anything it cannot do falls through to
  // the swipes, unchanged. The `direction` argument is deliberately NOT passed to
  // it: the driver works out which way to go, and a wrong guess here would be a
  // silent behaviour change rather than a speed-up.
  // ⚠️ ONLY FOR A PLAIN, SINGLY-IDENTIFIED TARGET, and that restriction is the
  // whole design. The first version resolved the path with `root.find(path)`
  // whatever it was, which walks every ancestor and - for a `#text in` path - runs
  // a full by-text resolution, and THEN still fell through to the ladder when the
  // driver could not help. Measured on iOS: it moved one test from 406 calls to
  // 366 and pushed another from 689 to 1684. Net worse, in the one unit that
  // matters for CI.
  //
  // So the target is addressed by its OWN exact id in one lookup, and anything
  // else - a collection member, a text match, an index - skips this entirely and
  // pays exactly what it paid before.
  const pattern = Component.isFiltered(path)
    ? undefined
    : root.definitionFor(path).selector?.idPattern;
  const exactId =
    pattern?.kind === "exact" && pattern.ids.length === 1 ? pattern.ids[0] : undefined;

  if (exactId) {
    try {
      if (browser.isIOS) {
        const locator = byTestId(exactId).ios;
        const element = await $(locator);
        await browser.execute("mobile: scrollToElement", {
          elementId: (element as unknown as WebdriverIO.Element).elementId,
        });
      } else {
        await browser.execute("mobile: scroll", {
          strategy: "-android uiautomator",
          selector: `new UiSelector().resourceId("${exactId}")`,
          maxSwipes,
        });
      }
      if (await visible()) return;
    } catch {
      /* not scrollable this way - the ladder below is the answer */
    }
  }

  for (let i = 0; i < maxSwipes; i++) {
    await scroll(direction, 1);
    if (await visible()) return;
  }

  throw new Error(
    `"${path}" was still not on screen after ${maxSwipes} swipe(s) ${direction}.`,
  );
}

/**
 * Wait until a collection holds at least `min` members, and return the count.
 *
 * A list's ROWS arrive from the network some time after the screen that holds
 * them has rendered, so waiting on the container tells you nothing - which is
 * what the fixed multi-second pauses before every `getCount` assertion were
 * really standing in for. This waits for the DATA instead: it returns the
 * moment the rows are there, and fails naming the collection rather than
 * leaving a `toBeGreaterThan(0)` to fail on an empty list a beat too early.
 */
export async function waitForCount(
  root: Component,
  path: string,
  min = 1,
  // ⚠️ SCALED - see waitForChecked above. This one waits for a list's DATA to
  // arrive from the network, which is the wait most obviously sensitive to a slow,
  // contended agent.
  timeout = scaled(20000),
): Promise<number> {
  let count = 0;
  await browser.waitUntil(
    async () => {
      // ⚠️ The try/catch is load-bearing - do not "simplify" it away.
      //
      // getCount resolves the collection's CONTAINER first, and a lookup for a
      // container that is not on screen yet THROWS rather than returning zero.
      // An exception inside a waitUntil condition aborts the whole wait on its
      // first tick, so the wait for data was failing precisely in the case it
      // exists to handle: the screen has rendered but the list has not.
      //
      // Caught live: a list-filtering test died with `Can't call $$ on element
      // with selector .//*[@name="…list"] because element wasn't found`, having
      // polled exactly once. The same test passed on the previous run, which is
      // what made it look like flake rather than a missing guard. Treating "not
      // there yet" as zero makes it poll properly.
      //
      // Same reasoning as scrollUntilDisplayed's visible() above. Rule 6.
      try {
        count = await getCount(root, path);
      } catch {
        count = 0;
      }
      return count >= min;
    },
    {
      timeout,
      interval: 500,
      timeoutMsg:
        `"${path}" still had ${count} member(s) after ${timeout / 1000}s, ` +
        `expected at least ${min}.`,
    },
  );
  return count;
}
