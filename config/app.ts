/**
 * THE ONE FILE YOU EDIT TO POINT THIS FRAMEWORK AT YOUR APP.
 *
 * Everything downstream reads from here: the Appium capabilities, the device
 * lock, the recovery paths in test/support/session.ts, and the capture commands
 * the `inspect-live-screen` skill runs. Nothing else hardcodes an app id.
 *
 * The values below describe the bundled demo app (Sauce Labs' My Demo App RN).
 * Replace them, drop your binary in apps/, and the framework is yours.
 *
 * ⚠️ Anything a spec should be able to change per-run belongs in the ENVIRONMENT
 * (see the `??` fallbacks), not here. This file is the default, not the override.
 */

export type AuthStrategy =
  /** Credentials are typed into the app's own React Native views. */
  | "in-app"
  /** Credentials go through a hosted WebView (Azure B2C, Auth0, Okta...). */
  | "webview"
  /** The app opens straight onto usable content. */
  | "none";

export interface PlatformApp {
  /** Bundle id (iOS) / package name (Android). The SAME id the build installs. */
  id: string;
  /** Path to the binary, relative to the repo root. */
  app: string;
  /** Android only - the launchable activity. */
  activity?: string;
}

export interface AppDefinition {
  /** Human name, used in logs, artefact filenames and report headings. */
  name: string;
  android: PlatformApp;
  ios: PlatformApp;
  auth: { strategy: AuthStrategy };
  /**
   * Where deterministic test data comes from. "none" means the suite asserts
   * against whatever the app ships with - correct for a demo, and the honest
   * default. See test/support/testData.ts to plug in a real provider.
   */
  testData: { provider: "none" | string };

  /**
   * ⚠️ iOS ONLY: how to tell one of YOUR ids from a visible label.
   *
   * On iOS `@name` FALLS BACK to an element's visible label when it has no
   * accessibilityIdentifier, so every untagged text node arrives looking like a
   * tagged one. On a real screen that reported "Primary Email", "Telephone" and
   * a 900-character concatenation of the whole screen as duplicated ids - noise,
   * and enough of it to bury a genuine finding.
   *
   * ANDROID NEEDS NO SUCH RULE. `resource-id` and `content-desc` are explicit
   * and never fall back to text, so every id there is genuine by construction
   * and this pattern is not applied.
   *
   * The default matches dotted lowerCamel (`settings.account.card`), the most
   * common React Native convention. Widen it if yours differs.
   */
  iosTestIdPattern?: RegExp;
}

export const APP: AppDefinition = {
  name: "My Demo App RN",

  android: {
    id: "com.saucelabs.mydemoapp.rn",
    activity: ".MainActivity",
    app: process.env.ANDROID_APP_PATH ?? "./apps/MyDemoAppRN.apk",
  },

  ios: {
    id: "com.saucelabs.mydemoapp.rn",
    app: process.env.IOS_APP_PATH ?? "./apps/MyDemoAppRN.app",
  },

  auth: { strategy: "in-app" },

  testData: { provider: "none" },

  // ⚠️ iOS ONLY, and worth measuring before you change it. `main`'s default
  // matches dotted lowerCamel (`settings.account.card`). THE DEMO APP TAGS WITH
  // accessibilityLabel rather than accessibilityIdentifier, so its ids arrive as
  // plain phrases ("open menu", "Login button") and the dotted default would
  // reject every one of them - hence `/./`, accept anything non-empty. Run an
  // exploratory sweep against your own app and see what the noise looks like
  // before deciding.
  iosTestIdPattern: /./,
};

/** The app id for the platform this run is driving. */
export function appId(isIOS: boolean): string {
  return isIOS ? APP.ios.id : APP.android.id;
}

/** The binary for the platform this run is driving. */
export function appPath(isIOS: boolean): string {
  return isIOS ? APP.ios.app : APP.android.app;
}
