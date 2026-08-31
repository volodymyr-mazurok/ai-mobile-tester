# App quirks

Things about **the app under test** that surprise a test author. Not bugs to file -
bugs go to [../findings/APP_ISSUES.md](../findings/APP_ISSUES.md). These are facts
about the accessibility tree you have to design around.

> ⚠️ **Rewrite this file for your app.** What follows describes the bundled demo app
> (Sauce Labs' My Demo App RN v1.3.0) plus the platform-level quirks that are true of
> every React Native app. Keep the second half; replace the first.

---

## This app

### Ids are `accessibilityLabel`, not `testID`

Every id is on Android's **`content-desc`**, not `resource-id`. The app's only
`resource-id` values are Android's own (`android:id/content`).

This matters more than it sounds. A framework that assumes `testID` reports **zero
ids on every screen** against this app - which is exactly what happened here on the
first sweep, turning every text node into an "untagged text" finding and making a
working control look dead. `byTestId()` matches both attributes; see
[../history/experiments.md](../history/experiments.md).

### Product cells share one id per field

On the catalogue, every product is `store item`, every title `store item text`, every
price `store item price`, every rating `review star 1..5`. Six products means **six
matches for each of eight ids**.

Consequence: you **cannot** address a product by name. You must match the row - by
its visible text or index - and then look up its fields **inside** that row. This is
THE ONE RULE doing real work rather than being a style preference.

Filed as testability ask
[#1](../findings/TESTID_IMPROVEMENTS.md).

### The Cart is not in the drawer

Every other top-level screen is a navigation-drawer entry. The Cart is reached from
the **cart badge in the header**. Assuming otherwise means inventing a
`menu item cart` that does not exist.

### Logging out raises two native dialogs, back to back

Tap Log Out and you get an `AlertDialog` confirm, then a second `AlertDialog`
acknowledgement ("You are successfully logged out."). Dismiss only the first and the
second sits in front of the app, and every later lookup fails against a screen nobody
can see past.

Neither carries an accessibility id - they are addressed by `android:id/button1`.

### "Log In" while already signed in opens the Cart

The drawer shows both **Log In** and **Log Out** in either state, so neither is a
tell. Tapping Log In while authenticated navigates to the cart, not to an account
screen. That is why `app.contract.ts`'s `isSignedOut()` has to navigate: the app
offers no passive way to tell.

### The app browses without authentication

The catalogue renders identically signed in or out. Auth only matters at checkout.
So `waitForAppReady()` treats the catalogue, the login form **and** the cart as
legitimate resting states.

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
