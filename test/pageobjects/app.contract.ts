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
 * ⚠️ EVERY SELECTOR BELOW IS A PLACEHOLDER. Capture your app's real screens
 * first (`inspect-live-screen`) and replace them. Rule 2: never guess a
 * selector - the first thing the exploratory sweep ever caught was its author
 * inventing one.
 *
 * A filled-in, working version of this file lives on the `demo` branch.
 *
 * Deliberately SELF-CONTAINED - it declares the handful of elements it needs
 * rather than importing your feature page objects. Those are free to change
 * shape as a suite grows; the recovery paths in test/support/session.ts are not,
 * and a cycle between them is the last thing you want to debug at 40 minutes
 * into a run.
 *
 * ⚠️ byTestId() matches BOTH `resource-id` AND `content-desc` on Android,
 * because React Native puts `testID` on one and `accessibilityLabel` on the
 * other and apps use either. If a capture shows your ids arriving as
 * `content-desc`, that is normal and already handled (see component.ts).
 */

/** Just enough of the app to answer "where are we?" and "get me signed out". */
class ContractElements extends Component {
  constructor() {
    super({ alias: "App" });

    // ⚠️ THE RESTING STATES: every screen a launch can legitimately settle on.
    // A launch settles on exactly one of them, and waitForAppReady() below is
    // satisfied by any. Name every one your app can land on - a state you leave
    // out here reads to the framework as "still loading", and every recovery
    // path will spend its full timeout before failing.
    this.defineComponent({ alias: "Home Screen", selector: byTestId("home screen") });
    this.defineComponent({ alias: "Login Screen", selector: byTestId("login screen") });

    // Chrome present on every screen - whatever opens your navigation.
    this.defineComponent({ alias: "Menu Button", selector: byTestId("open menu") });

    // ⚠️ DECLARED FLAT, at page level, with full ids - not nested under the
    // drawer. A drawer or modal renders OVER the screen rather than inside it,
    // and a nested lookup does not reliably resolve the presented copy. Rule 3.
    this.defineComponent({ alias: "Menu Log In", selector: byTestId("menu item log in") });
    this.defineComponent({ alias: "Menu Log Out", selector: byTestId("menu item log out") });

    // ⚠️ NATIVE DIALOGS ARE NOT REACT NATIVE VIEWS and usually carry no
    // accessibility id at all - only the platform's own. That is what the "raw
    // platform locator at the use site" escape hatch in byTestId's docblock is
    // for, and it is a testability finding worth raising with the app team.
    this.defineComponent({
      alias: "Dialog Confirm",
      selector: { ios: `.//*[@name="OK"]`, android: `.//*[@resource-id="android:id/button1"]` },
    });
  }
}

const app = new ContractElements();

/** Is one of the app's resting screens on display right now? */
async function atRest(): Promise<boolean> {
  for (const alias of ["Home Screen", "Login Screen"]) {
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
        "The app reached none of its resting screens - it is probably still on " +
        "a splash, behind a permission dialog, or wedged.",
    });
  },

  /**
   * Is nobody signed in right now?
   *
   * ⚠️ PREFER A PASSIVE TELL IF YOUR APP HAS ONE - an avatar, an account name,
   * a tab that only exists when authenticated. Reading one element is cheap and
   * cannot change where the app is.
   *
   * ⚠️ IF IT DOES NOT, THIS HAS TO NAVIGATE, and that is legitimate. A
   * browse-first app can render identically signed in or out, with a menu that
   * shows both "Log In" and "Log Out" in either state - no passive tell exists
   * anywhere on screen, and tapping through is the only discriminator the app
   * offers. Callers already treat this as expensive and only reach it on a
   * recovery path. The demo branch has a worked example.
   */
  async isSignedOut(): Promise<boolean> {
    // ⚠️ The menu may ALREADY be open - a cancelled dialog, a previous step, a
    // failed assertion. Tapping the handle then would CLOSE it and hide the
    // entry we are about to look for, and the failure reads as "Log In not
    // displayed" rather than "the menu was already open".
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
   * Get to a signed-out state, and clear anything the flow puts on screen.
   *
   * ⚠️ COUNT THE DIALOGS. A sign-out often raises more than one - a confirm,
   * then an acknowledgement. Dismissing only the first leaves the second in
   * front of the app, and every subsequent lookup fails against a screen nobody
   * can see past. The loop below clears up to two; check what yours actually
   * does on a live capture.
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
