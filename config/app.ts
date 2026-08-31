/**
 * THE ONE FILE YOU EDIT TO POINT THIS FRAMEWORK AT YOUR APP.
 *
 * Everything downstream reads from here: the Appium capabilities, the device
 * lock, the recovery paths in test/support/session.ts, and the capture commands
 * the `inspect-live-screen` skill runs. Nothing else hardcodes an app id.
 *
 * ⚠️ THE VALUES BELOW ARE PLACEHOLDERS. Replace every one of them, drop your
 * binary in apps/, and the framework is yours. Nothing runs until you do.
 *
 * A filled-in, running example of this file lives on the `demo` branch, wired
 * to Sauce Labs' My Demo App RN.
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
  name: "CHANGE ME",

  android: {
    // The package name your build installs. `adb shell pm list packages` on a
    // device that has it, or read it off the build's applicationId.
    id: "com.example.yourapp",
    // The launchable activity. `adb shell cmd package resolve-activity --brief <id>`.
    activity: ".MainActivity",
    app: process.env.ANDROID_APP_PATH ?? "./apps/YourApp.apk",
  },

  ios: {
    // The bundle identifier. Xcode > target > General, or `defaults read
    // <YourApp.app>/Info CFBundleIdentifier`.
    id: "com.example.yourapp",
    // A SIMULATOR build (.app), not a device .ipa.
    app: process.env.IOS_APP_PATH ?? "./apps/YourApp.app",
  },

  // "in-app" | "webview" | "none" - see AuthStrategy above.
  // ⚠️ "webview" changes how credentials are entered: those fields go through
  // utils/webViewInput.ts and are PASTED, never setValue'd. Rule 18.
  auth: { strategy: "none" },

  testData: { provider: "none" },

  // ⚠️ iOS ONLY, and worth measuring before you change it. The default matches
  // dotted lowerCamel (`settings.account.card`). If your iOS build tags with
  // accessibilityLabel rather than accessibilityIdentifier, the ids are plain
  // phrases and this must be widened - the demo branch sets /./ for exactly
  // that reason. Run an exploratory sweep and see what the noise looks like
  // before deciding.
  iosTestIdPattern: /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/,
};

/** The app id for the platform this run is driving. */
export function appId(isIOS: boolean): string {
  return isIOS ? APP.ios.id : APP.android.id;
}

/** The binary for the platform this run is driving. */
export function appPath(isIOS: boolean): string {
  return isIOS ? APP.ios.app : APP.android.app;
}
