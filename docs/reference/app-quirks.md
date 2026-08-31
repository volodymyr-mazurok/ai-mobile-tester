# App quirks

Things about **the app under test** that surprise a test author. Not bugs to file -
bugs go to [../findings/APP_ISSUES.md](../findings/APP_ISSUES.md). These are facts
about the accessibility tree you have to design around.

> ⚠️ **The "This app" section is yours to write.** The second half is true of every
> React Native app and applies as-is. A worked example of the first half - covering a
> real app's id scheme, its two-dialog logout and a screen that is not where you would
> expect it - is on the `demo` branch.

---

## This app

*(nothing recorded yet. An exploratory sweep is the cheapest way to find these:
`npm run explore:android`. Each entry should name the surprise, what it costs a test
author, and how to work around it.)*

Things worth checking for early, because they change how you declare page objects:

- **Which attribute carries your ids** - `resource-id` or `content-desc`. React
  Native puts `testID` on one and `accessibilityLabel` on the other. Get this wrong
  and a sweep reports zero ids on every screen.
- **Ids that are not unique** - list rows that share one id per field. Forces you to
  match the row first, then look up inside it. THE ONE RULE doing real work.
- **Screens that are not reached the way the others are** - the one that hangs off a
  header control rather than the navigation drawer.
- **How many dialogs a flow raises.** Dismissing only the first leaves the second in
  front of everything.
- **Whether the app has a passive signed-in tell** at all. If it does not,
  `isSignedOut()` has to navigate, and that is legitimate.

---

## Every React Native app

### Android's page source contains only what is LAID OUT

A section below the fold is **not in the tree at all** - not "present but invisible",
absent. So:

- a test that scrolls to a heading and then reads its lower children fails on Android
  and passes on iOS,
- and the same test passes on one screen size and fails on another.

This is the single biggest source of "works locally, fails in CI". It is why
`config/androidDevice.json` pins the screen geometry.

### `visible="false"` does not mean invisible

RN renders nodes that are laid out but marked not visible. Waiting on
`isDisplayed()` for such a node waits forever; `isExisting` finds it immediately.
Check a capture before choosing which to wait on.

### A `<Modal>` renders outside its parent

React Native presents a modal at the root of the tree, not inside the component that
declared it. A nested lookup does not reliably resolve the presented copy - hence
rule 3: modals are declared **flat**, at page level, with full ids. The same is true
of a drawer rendered over the screen.

### iOS `@name` falls back to the visible label

An element with no `accessibilityIdentifier` reports its **label** as `@name`. So on
iOS every untagged text node looks tagged, and a duplicate-id oracle run naively will
report sentences as ids. Android has no equivalent - `resource-id` and `content-desc`
never fall back. See `iosTestIdPattern` in `config/app.ts`.

### `autoAcceptAlerts` eats native alerts

Convenient until a test wants to assert on one. If an expected alert never appears,
check the capability before concluding the app did not raise it.
