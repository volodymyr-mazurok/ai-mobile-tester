import { browser } from "@wdio/globals";
import { Component, byTestId } from "./abstraction/component";
import { AppContract } from "../support/appContract";
import { scaled } from "../support/timeouts";

/**
 * WHAT THE FRAMEWORK ITSELF NEEDS TO KNOW ABOUT THIS APP.
 *
 * ⚠️ THIS IS ONE OF THE THREE FILES YOU WRITE TO ADOPT THE FRAMEWORK.
 * The other two are config/app.ts and test/pageobjects/screens.ts.
 *
 * Deliberately SELF-CONTAINED - it declares the handful of elements it needs
 * rather than importing your feature page objects. Those are free to change
 * shape as a suite grows; the recovery paths in test/support/session.ts are not,
 * and a cycle between them is the last thing you want to debug at 40 minutes
 * into a run.
 *
 * The app here is Sauce Labs' My Demo App RN, tagged with accessibilityLabel -
 * so on Android every id below is a `content-desc`, not a `resource-id`.
 * byTestId() matches either (see component.ts).
 */

/** Just enough of the app to answer "where are we?" and "get me signed out". */
class ContractElements extends Component {
  constructor() {
    super({ alias: "App" });

    // The three resting states. A launch settles on exactly one of them.
    this.defineComponent({ alias: "Catalog Screen", selector: byTestId("products screen") });
    this.defineComponent({ alias: "Login Screen", selector: byTestId("login screen") });
    this.defineComponent({ alias: "Cart Screen", selector: byTestId("cart screen") });

    // Chrome present on every screen.
    this.defineComponent({ alias: "Menu Button", selector: byTestId("open menu") });

    // Drawer items. Declared FLAT at page level, not nested under the drawer:
    // the RN drawer renders over the screen and a nested lookup does not
    // reliably resolve the presented copy. Same reasoning as the modal rule.
    this.defineComponent({ alias: "Menu Log In", selector: byTestId("menu item log in") });
    this.defineComponent({ alias: "Menu Log Out", selector: byTestId("menu item log out") });
    this.defineComponent({ alias: "Menu Catalog", selector: byTestId("menu item catalog") });

    // ⚠️ NATIVE ANDROID DIALOGS, not React Native views. The logout flow raises
    // two of them in a row (a confirm, then an acknowledgement) and NEITHER
    // carries an accessibility id - so these are addressed by resource-id and
    // text, which is exactly the "raw XPath at the use site" escape hatch
    // byTestId's docblock describes. Filed as a testability finding.
    this.defineComponent({
      alias: "Dialog Confirm",
      selector: { ios: `.//*[@name="OK"]`, android: `.//*[@resource-id="android:id/button1"]` },
    });
  }
}

const app = new ContractElements();

/** Is one of the app's resting screens on display right now? */
async function atRest(): Promise<boolean> {
  for (const alias of ["Catalog Screen", "Login Screen", "Cart Screen"]) {
    if (await shows(alias)) return true;
  }
  return false;
}

/** Displayed right now? False - never a throw - when it is not on screen at all. */
function shows(alias: string): Promise<boolean> {
  return app.find(alias).then(
    (el) => el.isDisplayed(),
    () => false,
  );
}

const contract: AppContract = {
  /**
   * Settle on any screen a test could work from.
   *
   * ⚠️ WAITS ON THE CONDITION, never `isDisplayed()` once. On a cold launch the
   * RN bundle takes seconds to render and a point-in-time read is simply false
   * (rule 6). The timeout is generous because this also runs on the recovery
   * path, after a reinstall, on a CI agent with one vCPU.
   */
  async waitForAppReady(): Promise<void> {
    await browser.waitUntil(atRest, {
      timeout: scaled(60_000),
      interval: 500,
      // ⚠️ A STRING, not a template that awaits anything. An `await` inside a
      // timeoutMsg runs BEFORE the wait does (rule 8).
      timeoutMsg:
        "The app reached none of its resting screens (catalog, login, cart) - " +
        "it is probably still on a splash, behind a permission dialog, or wedged.",
    });
  },

  /**
   * ⚠️ THIS ONE NAVIGATES, and it has to.
   *
   * The app is browse-first: the catalog renders identically whether or not
   * anyone is signed in, and the drawer shows BOTH "Log In" and "Log Out" in
   * either state - so there is no passive tell anywhere on screen. Opening the
   * drawer and tapping Log In is the only discriminator the app offers:
   * signed out lands on the login form, signed in lands on the cart.
   *
   * Callers already treat it as expensive and only reach it on a recovery path.
   */
  async isSignedOut(): Promise<boolean> {
    // ⚠️ The drawer may ALREADY be open - a cancelled dialog, a previous step, a
    // failed assertion. Tapping the handle then would CLOSE it and hide the entry
    // we are about to look for, and the failure reads as "Log In not displayed"
    // rather than "the drawer was already open". Same trap as DrawerScreen.open().
    if (!(await shows("Menu Log In")))
      await app.find("Menu Button").then((el) => el.click());
    await app.find("Menu Log In").then((el) => el.click());

    await browser.waitUntil(atRest, {
      timeout: scaled(20_000),
      interval: 300,
      timeoutMsg: "Tapped Log In and the app settled on no known screen.",
    });

    return shows("Login Screen");
  },

  /**
   * Tap Log Out and clear BOTH dialogs it raises.
   *
   * ⚠️ TWO dialogs, not one: a "are you sure" confirm, then a "you are
   * successfully logged out" acknowledgement. Dismissing only the first leaves
   * the second in front of the app, and every subsequent lookup then fails
   * against a screen nobody can see past. Both use android:id/button1.
   *
   * Best-effort throughout: callers always follow this with a check rather than
   * trusting it, so a missing dialog is not an error.
   */
  async logout(): Promise<void> {
    await app.find("Menu Button").then((el) => el.click());
    await app.find("Menu Log Out").then((el) => el.click());

    for (let dialog = 0; dialog < 2; dialog++) {
      const confirm = await app.find("Dialog Confirm").catch(() => null);
      if (!confirm) break;
      await confirm.click().catch(() => undefined);
      // Wait for THIS dialog to go before looking for the next, rather than
      // pausing and hoping (rule 5). Without it the second iteration re-finds
      // the first dialog mid-teardown and clicks a detached element.
      await browser
        .waitUntil(async () => !(await shows("Dialog Confirm")), {
          timeout: scaled(5_000),
          interval: 200,
        })
        .catch(() => undefined);
    }
  },
};

export default contract;
