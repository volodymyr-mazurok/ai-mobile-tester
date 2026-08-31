/**
 * Device-level work a run does around its sessions, all through simctl/adb rather
 * than the driver - which is what makes it usable from onPrepare/onComplete, where
 * no session exists.
 *
 * Everything here is BEST-EFFORT. A missing device, a missing adb or a wedged
 * emulator is not an error and must never kill a run; the boot step reports those
 * far better than a hook can.
 */
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { APP } from "../app";

// One id per platform, from config/app.ts. Read lazily inside the functions
// below - see the env-at-module-scope warning in capabilities.ts.
const bundleId = () => (isAndroid() ? APP.android.id : APP.ios.id);

// ⚠️ Lowercased, so this agrees with the capabilities selection in
// capabilities.ts - that is what decides which platform is actually driven.
// wdio.conf.ts used to spell this check five different ways, two lowercased and
// three not, so `PLATFORM=Android` got Android capabilities and iOS device work.
const isAndroid = () => (process.env.PLATFORM ?? "ios").toLowerCase() === "android";

/**
 * Print the attached Android device's fingerprint, and say so when it is not the
 * device this framework is verified against.
 *
 * ⚠️ THIS IS ABOUT "IT PASSES LOCALLY" MEANING SOMETHING. A local run and a CI run
 * are only comparable if they are the same experiment. The API level and the screen
 * SHAPE are what change outcomes: system images differ in how they expose a WebView
 * to the accessibility tree, and dp geometry decides what is above the fold, which
 * on Android decides what exists in the page source at all.
 *
 * Advisory by design. A mismatched device still produces a usable run, and a check
 * that refused to start would be worse than the confusion it prevents. See
 * config/androidDevice.json and docs/guides/devices.md.
 */
export async function reportAndroidDevice(): Promise<void> {
  if (!isAndroid()) return;
  try {
    // Relative to the repo root, which is where wdio is always invoked from -
    // import.meta is unavailable under this tsconfig's module setting.
    const expected = JSON.parse(
      readFileSync(`${process.cwd()}/config/androidDevice.json`, "utf8"),
    );

    const adb = (args: string[]) =>
      execFileSync("adb", args, { encoding: "utf8", timeout: 15000 }).trim();
    const prop = (name: string) => adb(["shell", "getprop", name]).replace(/\r/g, "");

    const api = Number(prop("ro.build.version.sdk"));
    const abi = prop("ro.product.cpu.abi");
    // `wm size` prints "Physical size: 720x1600", `wm density` prints "Physical
    // density: 240" - plus an override line when one is set, so take the last line.
    const size = adb(["shell", "wm", "size"]).split("\n").pop()?.match(/(\d+)x(\d+)/);
    const density = Number(adb(["shell", "wm", "density"]).split("\n").pop()?.match(/(\d+)/)?.[1]);
    const [w, h] = size ? [Number(size[1]), Number(size[2])] : [0, 0];
    const dp = density ? `${Math.round((w * 160) / density)}x${Math.round((h * 160) / density)} dp` : "?";

    console.log(`[device] android API ${api} / ${abi} / ${w}x${h} @${density}dpi = ${dp}`);

    const drift: string[] = [];
    if (api !== expected.apiLevel) drift.push(`API ${api}, expected ${expected.apiLevel}`);
    if (w !== expected.lcdWidth || h !== expected.lcdHeight || density !== expected.lcdDensity)
      drift.push(
        `screen ${w}x${h} @${density}dpi, expected ` +
          `${expected.lcdWidth}x${expected.lcdHeight} @${expected.lcdDensity}dpi`,
      );
    if (drift.length)
      console.warn(
        `[device] ⚠️ THIS IS NOT THE VERIFIED DEVICE: ${drift.join("; ")}. ` +
          `A failure here may be the device rather than the app, and a pass may not ` +
          `reproduce in CI. \`npm run android:avd\` creates the right one.`,
      );
    // ABI is expected to differ by host - an emulator must match the host CPU or it
    // is unusably slow - so it is printed above rather than warned about.
  } catch {
    /* no device, no adb, or a wedged one */
  }
}

/**
 * Remove the app AND its stored auth token from the booted device.
 *
 * Called at BOTH ends of a run: onComplete drops the session before the fixture's
 * teardown deletes anything, so the app is never left holding a token for an identity
 * that no longer exists, and onPrepare repeats it as belt-and-braces for a ctrl-C'd
 * run or an app someone signed into by hand.
 *
 * ⚠️ THE KEYCHAIN RESET IS THE LOAD-BEARING HALF ON iOS. Uninstalling is not
 * enough: iOS keeps keychain items across an uninstall, and an app's auth token
 * usually lives there - so a reinstalled app reads the SAME token back and comes up signed in
 * as whoever was signed in before. With the uninstall alone, the next spec still
 * logged `a DIFFERENT account is signed in`. It is also how an app ends up holding a
 * token for an identity that has since been DELETED - a blank screen it cannot
 * recover from through any number of reinstalls.
 *
 * This resets the SIMULATOR's whole keychain, not just the app's items - fine for a
 * dedicated test simulator, and there is no narrower switch. Android needs no
 * keychain step: `adb uninstall` takes the app's data and its app-scoped Keystore
 * entries with it.
 */
export async function clearInstalledApp(reason: string): Promise<void> {
  const run = (command: string) => {
    try {
      execSync(command, { stdio: "ignore" });
    } catch {
      /* nothing installed, or no device */
    }
  };

  if (isAndroid()) {
    run(`adb uninstall ${bundleId()}`);
  } else {
    // The exact device CI booted when it told us, else "booted" - which only
    // resolves while exactly ONE simulator is up, and so quietly stops working the
    // moment a second one appears.
    const device = process.env.IOS_UDID ?? "booted";
    run(`xcrun simctl uninstall ${device} ${bundleId()}`);
    run(`xcrun simctl keychain ${device} reset`);
  }
  console.log(`[run] cleared ${bundleId()} install - ${reason}`);
}

/**
 * Note a non-Latin keyboard on the Simulator, and fix nothing.
 *
 * XCUITest types through the device's ACTIVE KEYBOARD, and a hosted login's password
 * input gets the system default - so with a Cyrillic layout active every Latin letter
 * typed into it was silently dropped and only the digits arrived. That accounted for
 * every "the hosted login truncates the password" measurement the predecessor project
 * ever recorded, none of which was about the login page at all.
 *
 * ✅ No longer fatal: utils/webViewInput.ts PASTES these values, and pasting involves
 * no layout at all. This warns only because every device-side fix was tried and none
 * can work - iOS re-adds the layout on boot, and `simctl erase` does not clear it,
 * since simulators inherit the host Mac's input sources. See
 * docs/history/experiments.md.
 */
export async function noteNonLatinKeyboards(): Promise<void> {
  if (isAndroid()) return;
  try {
    const installed = [
      ...execSync(
        `xcrun simctl spawn ${process.env.IOS_UDID ?? "booted"} defaults read .GlobalPreferences AppleKeyboards`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).matchAll(/"([^"]+)"/g),
    ].map((m) => m[1]);

    const LATIN =
      /^(en|fr|de|es|it|pt|nl|sv|da|nb|nn|fi|is|pl|cs|sk|hu|ro|hr|sl|et|lv|lt|tr|vi|id|ms|sw|af|sq|eu|ca|cy|ga|gl|lb|mt|emoji)([_-]|@|$)/i;
    const nonLatin = installed.filter((keyboard) => !LATIN.test(keyboard));
    if (nonLatin.length)
      console.log(
        `[run] note: non-Latin keyboard(s) installed (${nonLatin.join(", ")}). ` +
          "Values are PASTED rather than typed, so this is survivable - but if a " +
          "sign-in ever fails with a password holding only its digits, this is why.",
      );
  } catch {
    /* no booted sim, or the key is unset (factory default) */
  }
}

/**
 * AOT-compile the app on Android, once the driver has installed it.
 *
 * ⚠️ This attacks the cost rather than waiting longer for it. logcat timed the app at
 * 161 SECONDS from process start to first frame on a hosted agent, and named where a
 * third of it went: `Verification of <class> took 282.533ms`, 202 times, 54.7s in
 * total. A debug APK ships dex with no ahead-of-time compilation, so ART verifies and
 * JITs every Firebase / Kotlin / AndroidX class on the way to the first frame.
 *
 * `cmd package compile -m speed` does that work once, here, instead of during every
 * launch - and afterSuite relaunches the app between every pair of spec files.
 *
 * Three deliberate choices:
 *  - NO `-f`. Without force, dex2oat skips a package already compiled to this filter,
 *    so the second and later spec files cost nothing.
 *  - Straight `adb`, not `mobile: shell`, which would need Appium's `adb_shell`
 *    insecure feature - a security relaxation for the whole server.
 *  - Best-effort and time-bounded. A pure optimisation must never fail or hang a run.
 */
export async function aotCompileApp(): Promise<void> {
  if (!isAndroid()) return;

  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const adb = sdk ? `${sdk}/platform-tools/adb` : "adb";
  const started = Date.now();
  const elapsed = () => Math.round((Date.now() - started) / 1000);

  try {
    execFileSync(adb, ["shell", "cmd", "package", "compile", "-m", "speed", bundleId()], {
      // A ceiling, not an expectation: past it the run simply proceeds with an
      // un-compiled app, exactly as it did before.
      timeout: 300000,
      stdio: "pipe",
    });
    console.log(
      `[run] AOT-compiled ${bundleId()} (-m speed) in ${elapsed()}s - ` +
        "launches skip class verification from here on",
    );
  } catch (e) {
    // Includes "adb not on PATH", "package not installed yet" and the timeout. None
    // of them is worth failing a run for.
    console.log(
      `[run] could not AOT-compile ${bundleId()} after ${elapsed()}s ` +
        `- continuing without it: ${(e as Error).message.split("\n")[0]}`,
    );
  }
}
