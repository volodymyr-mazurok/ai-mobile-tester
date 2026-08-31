import * as fs from "fs";
import * as path from "path";
import { browser, driver } from "@wdio/globals";
import { APP, appId, appPath } from "../../config/app";
import { appContract } from "./appContract";

/**
 * Getting the app back to a state a test can work from - the recovery paths.
 *
 * Nothing here knows anything about YOUR app beyond config/app.ts and the three
 * methods in AppContract. What it does know is how mobile test runs go wrong,
 * and every escalation below was bought with a real failed run.
 */

/**
 * Relaunch OUR app by id, rather than whatever happens to be in front.
 *
 * ⚠️ Not `browser.relaunchActiveApp()`. That restarts the ACTIVE app, and at the
 * start of a pre-auth suite the active app is not always ours: on Android a fresh
 * install can still have the POST_NOTIFICATIONS dialog in the foreground, so the
 * relaunch resolves `com.google.android.permissioncontroller` and the whole hook
 * dies with "Unable to resolve the launchable activity of
 * 'com.google.android.permissioncontroller'". Measured on a real run: it took out
 * the `before all` hooks of two entire spec files, 0 tests each.
 *
 * ⚠️ That used to carry the caveat "relaunchActiveApp() is still fine at the other
 * call sites, which all run mid-test with our app already in front" - and a later
 * build disproved it. The hooks that run AFTER A FAILURE (wdio.conf.ts's afterTest
 * recovery and afterSuite) run precisely when the foreground app is unknown, which
 * is the one state that caveat excluded.
 *
 * So: anything that relaunches without knowing what is in front uses this.
 * `relaunchActiveApp()` is reasonable only inside a test that has just been
 * driving our app.
 */
export async function relaunchOurApp(): Promise<void> {
  const id = appId(browser.isIOS);
  await browser.terminateApp(id).catch(() => undefined);
  await browser.activateApp(id);
}

/**
 * Leave the app sitting on its signed-out entry point, whatever it was showing.
 *
 * Pre-auth suites need this and none of them can assume where the previous spec
 * file left the app - `noReset: true` keeps the auth token AND the navigation
 * state, and a suite that failed mid-flow can leave a modal or a hosted auth page
 * on screen.
 *
 * Relaunching FIRST is what makes it reliable: waitForAppReady() only knows the
 * app's resting states, so calling it while a detail sheet or a half-finished
 * flow is up just burns its full timeout and then fails. A relaunch costs a few
 * seconds and guarantees one of the resting states.
 *
 * WHY IT IS A LOOP. Signing out is not one action that either works or doesn't:
 *
 *  - An in-app Logout clears the APP's token but not necessarily the IDENTITY
 *    PROVIDER's session. With a hosted login (B2C, Auth0, Okta) the WebView can
 *    silently re-authenticate and land straight back inside the app.
 *  - A reinstall usually fixes that... but not always. Measured: a freshly
 *    reinstalled app came up ALREADY SIGNED IN, which means the provider session
 *    was not living solely in the app's sandbox. One reinstall then a single
 *    check therefore gave up too early.
 *
 * So it alternates the two. Whichever clears the session on a given run, this
 * reaches the entry point. It costs nothing when the app is already signed out -
 * the first check returns immediately.
 */
export async function ensureSignedOut(): Promise<void> {
  if (APP.auth.strategy === "none") return;

  if (!appContract.isSignedOut)
    throw new Error(
      `config/app.ts declares auth.strategy "${APP.auth.strategy}", but ` +
        `test/pageobjects/app.contract.ts implements no isSignedOut(). ` +
        `Implement it, or set the strategy to "none".`,
    );

  const ATTEMPTS = 3;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await relaunchOurApp();
    await waitForAppReadyOrRecover();
    if (await appContract.isSignedOut()) return;

    // Ask nicely first: tap the real Logout button.
    if (appContract.logout) {
      await appContract.logout().catch(() => undefined);
      await relaunchOurApp();
      await waitForAppReadyOrRecover();
    }
    if (await appContract.isSignedOut()) return;

    // Still in. Wipe the app and go round again - a fresh install plus a logout
    // clears more than either does alone.
    if (attempt < ATTEMPTS && !(await reinstallApp()))
      throw new Error(
        "Could not get the app back to its signed-out entry point: the in-app " +
          "logout left a live session and the app could not be reinstalled to " +
          `clear it. ${WEDGED_APP_MESSAGE}`,
      );
  }

  throw new Error(
    `Could not reach the signed-out entry point after ${ATTEMPTS} attempts, each ` +
      `a logout followed by a reinstall. The identity provider's session is ` +
      `surviving both.`,
  );
}

/**
 * Wait for the app to reach a state a test can work from, escalating if it doesn't.
 *
 * relaunch -> reinstall, in that order, because they fix different things: a
 * relaunch clears PROCESS state (a modal, a half-finished flow, a wedged render)
 * and a reinstall clears PERSISTED state (a token for an account that no longer
 * exists - see reinstallApp).
 *
 * Use this ANYWHERE a wait for the app to be ready can be reached with the app in
 * an unknown state. There were three such places and they all used to escalate
 * differently: the initial launch, the relaunch after logging a wrong account out,
 * and ensureSignedOut. The middle one is how a wedged app slipped through - the
 * logout itself put the app into the state only the first one knew how to recover.
 */
export async function waitForAppReadyOrRecover(): Promise<void> {
  try {
    await appContract.waitForAppReady();
    return;
  } catch {
    /* process state - a relaunch may be all it needs */
  }

  // ⚠️ relaunchOurApp(), NOT browser.relaunchActiveApp() - see its docblock.
  // This exact call site was missed when that helper was added, and it reproduced
  // the identical failure in CI a fortnight later: a fresh Android install left
  // the permission dialog in front, so the "relaunch" read
  // `com.google.android.permissioncontroller` as the active app and threw
  // "Unable to resolve the launchable activity" - taking out a spec's `before all`
  // hook, 0 tests run.
  //
  // Every path into this function can be reached with the app NOT in front - that
  // is the whole premise of a function called "OrRecover" - so the active app is
  // never a safe thing to relaunch here.
  await relaunchOurApp();
  try {
    await appContract.waitForAppReady();
    return;
  } catch {
    /* persisted state - only a reinstall clears it */
  }

  if (!(await reinstallApp())) throw new Error(WEDGED_APP_MESSAGE);
  await appContract.waitForAppReady();
}

export const WEDGED_APP_MESSAGE =
  "The app will not reach a usable state and could not be reinstalled (no app " +
  "path in the session capabilities). Reinstall it by hand, or run once with " +
  "ISOLATED=true, then try again. See reinstallApp() for why this happens.";

/**
 * Wipe and reinstall the app. Returns false if it was not safe to try.
 *
 * WHY A NON-ISOLATED RUN NEEDS THIS. `noReset: true` re-attaches to whatever the
 * last run left installed - and if your fixture deletes the account it seeded,
 * what the last run left is a session for a user that no longer exists.
 *
 * Measured on a real suite: on the next launch the app rendered a BLANK WHITE
 * SCREEN - no home, no sign-in form - and relaunching did not help, because the
 * poison was persisted, not in the process. EVERY spec file in the run failed in
 * its `before all` hook that way, which is what made non-isolated runs look
 * impossible. (It is also an app defect worth filing: a session whose account no
 * longer exists should fall back to the sign-in screen.)
 *
 * A reinstall is the only thing that clears it, so it happens HERE, on the
 * failure path, rather than making every run pay `fullReset`.
 *
 * ⚠️ It refuses unless it has an app path to install BACK. An earlier attempt read
 *    the bundle id from session capabilities, silently no-opped, and one
 *    partially-applied run left the app uninstalled altogether - so the order is
 *    terminate, remove, install, activate, and the guard above it is the
 *    important part.
 */
export async function reinstallApp(): Promise<boolean> {
  const capabilities = driver.capabilities as Record<string, unknown>;

  // The binary to put BACK. `appium:app` is not echoed back in the session
  // capabilities once the driver has installed from it (measured - this refused
  // for that reason on its first outing), so fall back to config/app.ts.
  // Existence is still checked below: the guard has to be a real one, or a
  // missing binary would leave the app uninstalled.
  const rawPath =
    (capabilities["appium:app"] as string | undefined) ?? appPath(browser.isIOS);

  const resolved = path.resolve(rawPath);
  if (!fs.existsSync(resolved)) return false;

  const bundleId =
    (capabilities["appium:bundleId"] as string | undefined) ?? appId(browser.isIOS);

  console.log(`[session] app is wedged - reinstalling ${bundleId} from ${resolved}`);
  await driver.terminateApp(bundleId).catch(() => undefined);
  await driver.removeApp(bundleId);

  // GRANT PERMISSIONS ON A MID-RUN REINSTALL
  // ⚠️ `appium:autoGrantPermissions` does NOT cover this. It applies to the install
  // Appium performs when it CREATES the session; an install issued later, from
  // here, gets nothing - so the app comes up with no permissions and Android 13+
  // puts the POST_NOTIFICATIONS dialog in front of it.
  //
  // That dialog killed the last three specs of a real run. The reinstall
  // succeeded, the app launched behind the dialog, and waitForAppReady then saw
  // none of its resting states for its full timeout - because none was reachable.
  // Three spec files each failed their `before all` hook, twice over with the
  // retry, after most of the run had already passed. The giveaway in the log is
  // the next line after the failure:
  //
  //   Unable to resolve the launchable activity of
  //   'com.google.android.permissioncontroller'
  //
  // i.e. the permission dialog was the FOREGROUND APP.
  //
  // `mobile: installApp` takes grantPermissions (verified against
  // appium-uiautomator2-driver's execute-method-map, not assumed). iOS has no
  // equivalent and needs none - its permission prompts are handled by
  // `appium:autoAcceptAlerts`, which is a session setting and stays in force.
  if (browser.isAndroid) {
    await driver.execute("mobile: installApp", { appPath: resolved, grantPermissions: true });
  } else {
    await driver.installApp(resolved);
  }

  await driver.activateApp(bundleId);
  return true;
}
