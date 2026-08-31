import ActionHelper from "../../utils/actionHelper";
import { byTestId, PlatformSelector } from "./abstraction/component";
import { relaunchOurApp, waitForAppReadyOrRecover } from "../support/session";
import { scaled } from "../support/timeouts";
import MobilePage from "./page";

/**
 * THE MAP OF YOUR APP, for anything that has to walk it without knowing it -
 * today the exploratory sweep charter (test/exploratory/sweep.charter.ts).
 *
 * ⚠️ ONE OF THE THREE FILES YOU WRITE TO ADOPT THE FRAMEWORK.
 * The other two are config/app.ts and test/pageobjects/app.contract.ts.
 *
 * A regression spec does NOT come through here - it imports the page object it
 * needs and says what it means. This exists for the generic passes: "visit
 * everything and run the oracles over it" needs a list, and that list is the
 * only app-shaped thing about them.
 *
 * Every id below was read off a live capture, not guessed. Do the same when you
 * add one: `inspect-live-screen`.
 */

/**
 * A screen, and how to get to it.
 *
 * ⚠️ `open()` IS PER-SCREEN, not a shared assumption, and this app is exactly
 * why. Most of its screens hang off the navigation drawer - but the Cart does
 * not: it is reached from a badge in the header. Modelling every screen as a
 * drawer entry meant guessing a `menu item cart` that does not exist, and the
 * very first sweep reported it as a step-failed. That is the framework's own
 * rule biting its author: capture the screen, never guess the selector.
 */
export abstract class AppScreen extends MobilePage {
  /** Get to this screen from wherever the app currently is. */
  abstract open(): Promise<void>;

  /**
   * Declare one child. Exists so the shared CHROME map can be applied from a
   * helper - `defineComponent` is protected, and deliberately so (a tree edited
   * from outside its class is a tree nobody can read in one place).
   */
  define(alias: string, selector: string | PlatformSelector): void {
    this.defineComponent({ alias, selector: typeof selector === "string" ? byTestId(selector) : selector });
  }
}

/** A screen reached by picking an entry out of the navigation drawer. */
/**
 * On EVERY screen: the drawer handle, the drawer's own entries, and the native
 * dialogs the app raises over whatever is showing.
 *
 * ⚠️ THE DRAWER ENTRIES AND DIALOGS ARE DECLARED FLAT, at page level, with full
 * ids - not nested under the drawer or the dialog. Both render OVER the screen
 * rather than inside it, and a nested lookup does not reliably resolve the
 * presented copy. Rule 3.
 *
 * ⚠️ The dialog parts are raw platform locators because the app's native
 * `AlertDialog`s carry NO accessibility id at all - only Android's own
 * `android:id/*`. That is a testability finding in its own right, and the
 * "raw XPath at the use site" escape hatch is what byTestId's docblock means.
 */
const CHROME: Record<string, string | PlatformSelector> = {
  "Menu Button": "open menu",
  "Menu Log In": "menu item log in",
  "Menu Log Out": "menu item log out",
  "Menu Catalog": "menu item catalog",
  "Menu Reset App": "menu item reset app",
  "Dialog Message": {
    ios: `.//*[@type="XCUIElementTypeStaticText"]`,
    android: `.//*[@resource-id="android:id/message"]`,
  },
  "Dialog Confirm": {
    ios: `.//*[@name="OK"]`,
    android: `.//*[@resource-id="android:id/button1"]`,
  },
  "Dialog Cancel": {
    ios: `.//*[@name="Cancel"]`,
    android: `.//*[@resource-id="android:id/button2"]`,
  },
};

/** Declare CHROME plus this screen's own extras. */
function declareAll(
  screen: { define: (alias: string, sel: string | PlatformSelector) => void },
  extras: Record<string, string | PlatformSelector>,
): void {
  for (const [alias, sel] of Object.entries({ ...CHROME, ...extras }))
    screen.define(alias, sel);
}

export class DrawerScreen extends AppScreen {
  constructor(
    alias: string,
    /** The drawer entry that opens it. */
    readonly menuItem: string,
    /** The id on the screen's own root, i.e. "we have arrived". */
    readonly rootId: string,
    /**
     * Anything else on this screen, as alias -> testID.
     *
     * ⚠️ Declared HERE, in the constructor, because defineComponent is
     * protected - a page object's shape is fixed by its class and cannot be
     * bolted onto an instance from outside. That is deliberate: a tree edited
     * at a distance is a tree nobody can read in one place.
     */
    extras: Record<string, string | PlatformSelector> = {},
  ) {
    super(alias);
    declareAll(this, { ...extras, "Menu Item": menuItem, Root: rootId });
  }

  async open(): Promise<void> {
    ActionHelper.setCurrentPage(this);
    // ⚠️ The drawer may ALREADY be open - a previous step can leave it that way,
    // and tapping the handle again would close it and hide the entry we want.
    // Checking for the entry first is what makes this safe to call from anywhere.
    if (!(await ActionHelper.isDisplayed("Menu Item"))) {
      await ActionHelper.click("Menu Button");
    }
    await ActionHelper.click("Menu Item");
  }
}

/** A screen reached from a control in the app header rather than the drawer. */
export class HeaderScreen extends AppScreen {
  constructor(
    alias: string,
    /** The header control that opens it. */
    readonly headerControl: string,
    readonly rootId: string,
    extras: Record<string, string | PlatformSelector> = {},
  ) {
    super(alias);
    declareAll(this, { ...extras, Opener: headerControl, Root: rootId });
  }

  async open(): Promise<void> {
    ActionHelper.setCurrentPage(this);
    await ActionHelper.click("Opener");
  }
}

export const Catalog = new DrawerScreen("Catalog", "menu item catalog", "products screen", {
  "Sort Button": "sort button",
  "Cart Badge": "cart badge",
});
// ⚠️ NOT a drawer screen - the drawer has no Cart entry. Verified on a live
// capture after guessing one and watching the sweep fail on it.
export const Cart = new HeaderScreen("Cart", "cart badge", "cart screen");
export const About = new DrawerScreen("About", "menu item about", "about screen");
export const Webview = new DrawerScreen("Webview", "menu item webview", "webview selection screen");
export const Drawing = new DrawerScreen("Drawing", "menu item drawing", "drawing screen");
export const ApiCalls = new DrawerScreen("ApiCalls", "menu item api calls", "api calls screen");
export const Login = new DrawerScreen("Login", "menu item log in", "login screen", {
  "Autofill Bob": "bob@example.com-autofill",
  "Login Button": "Login button",
});

/**
 * What the sweep visits, in order.
 *
 * ⚠️ NOT EVERY SCREEN, and the omissions are deliberate. QR Code Scanner and
 * Geo Location raise OS permission prompts, and Sauce Bot Video autoplays
 * media - all three make a sweep's timings meaningless and its screenshots a
 * lottery. A charter that needs them should say so and handle them explicitly.
 */
export const SCREENS: AppScreen[] = [Catalog, Cart, About, Webview, Drawing, ApiCalls];

/**
 * Controls no spec taps, recorded only for whether they do anything at all.
 * `probe()` reports `dead-control` when the tree does not move.
 */
export const PROBES: Array<{ name: string; screen: AppScreen; path: string }> = [
  { name: "catalog-sort", screen: Catalog, path: "Sort Button" },
  { name: "cart-badge", screen: Catalog, path: "Cart Badge" },
];

/**
 * Navigate to a screen and confirm we arrived.
 *
 * ⚠️ WAITS ON THE ROOT ID, rather than assuming the tap landed. The drawer
 * animates, and a screenshot taken mid-slide is a screenshot of two screens.
 *
 * ⚠️ RECOVERS FIRST IF THE DRAWER HANDLE IS NOT THERE. A charter is entitled to
 * leave the app anywhere - that is the whole point of probing controls nobody
 * has tested - and the next step should not inherit it. Measured on the first
 * real sweep: tapping the sort control opened a modal over the header, so the
 * NEXT step spent its full 10s failing to find "open menu" and was recorded as
 * a step-failed rather than as the finding it was.
 *
 * A relaunch is the cheap, total fix; waitForAppReadyOrRecover escalates to a
 * reinstall if even that is not enough.
 */
export async function visit(screen: AppScreen): Promise<void> {
  ActionHelper.setCurrentPage(screen);

  // The header is on every screen, so its absence means the app is somewhere a
  // charter left it - a modal, a native dialog, a half-finished flow. Recover
  // before navigating rather than spending a full timeout failing to.
  if (!(await ActionHelper.isDisplayed("Menu Button"))) {
    await relaunchOurApp();
    await waitForAppReadyOrRecover();
  }

  await screen.open();
  ActionHelper.setCurrentPage(screen);
  await ActionHelper.waitForDisplayed("Root", scaled(30_000));
}

/**
 * Sign in, for charters that want the authenticated view.
 *
 * ⚠️ THE CREDENTIALS ARE PUBLIC AND PRINTED ON THE APP'S OWN LOGIN SCREEN -
 * that is a property of this demo app, not a pattern to copy. In a real suite
 * they come from the environment (.env / a secret variable group), never from
 * a committed file. See config/env/requireEnv.ts.
 *
 * Uses the app's autofill link rather than typing, because typing is not what
 * this is testing - the sign-in SPEC types. This just needs to be signed in.
 */
export async function signInForExploration(): Promise<void> {
  await visit(Login);
  ActionHelper.setCurrentPage(Login);
  await ActionHelper.click("Autofill Bob");
  await ActionHelper.click("Login Button");

  ActionHelper.setCurrentPage(Catalog);
  await ActionHelper.waitForDisplayed("Root", scaled(30_000));
}
