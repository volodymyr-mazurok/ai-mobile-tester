#!/usr/bin/env node
/**
 * Boot (or kill) the Android emulator this framework runs against.
 *
 * WHY THIS EXISTS. WDIO does not start a device - it attaches to one. With no
 * emulator running, `npm run wdio:android` fails at session creation with
 * "Failed to create a session" and an empty `adb devices`, which reads like a
 * driver or capability problem and is really "there is no device". Every
 * Android run had to be preceded by booting one by hand.
 *
 * ⚠️ THE EMULATOR MUST OUTLIVE THE SHELL THAT STARTS IT. Backgrounding it with
 * a plain `&` from an npm script is not enough - when that shell exits it takes
 * the emulator with it, and the only symptom is the session failure above, much
 * later. Hence spawn(..., { detached: true }).unref() plus stdio redirected away
 * from this process's pipes: an inherited stdio keeps the child tied to the
 * parent even when detached.
 *
 * Idempotent on purpose: if a device is already booted this is a no-op, so it
 * is safe to chain in front of every Android npm script and safe to run twice.
 *
 *   node scripts/android-emulator.mjs boot     # start + wait for full boot
 *   node scripts/android-emulator.mjs kill     # shut down
 *   node scripts/android-emulator.mjs status   # what's running
 *
 * Env: ANDROID_HOME / ANDROID_SDK_ROOT, ANDROID_AVD (defaults below).
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SDK =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  "/opt/homebrew/share/android-commandlinetools";
// One device definition, shared with CI
// ⚠️ The default used to be a hard-coded "MobileQA_API35" that did not
// exist on the machine this was written on, while CI created an API 35 x86_64
// google_apis device at 480x1066 dp - so `npm run wdio:android` locally and the
// Android CI job were not the same experiment. Measured: the dev
// machine's only AVD was an API 37 arm64 playstore image at 426x952 dp, two
// platform versions apart and a different screen SHAPE. On Android the shape
// decides what is laid out, and what is laid out is all the page source contains,
// which is how three tests failed in CI and passed locally on the same commit.
//
// config/androidDevice.json is the definition; `npm run android:avd` creates
// exactly it. A CI job that restates the same numbers - because its config language
// cannot read JSON - has to be kept in step by hand; see docs/guides/ci.md.
const DEVICE = JSON.parse(
  readFileSync(new URL("../config/androidDevice.json", import.meta.url), "utf8"),
);
const AVD = process.env.ANDROID_AVD || DEVICE.avdName;
const BOOT_TIMEOUT_MS = Number(process.env.ANDROID_BOOT_TIMEOUT_MS || 240_000);

// Headless: no window and software rendering. Auto-detected on CI, or forced with
// ANDROID_EMULATOR_HEADLESS=true.
const HEADLESS =
  /^(1|true|yes)$/i.test(process.env.ANDROID_EMULATOR_HEADLESS || "") ||
  !!process.env.TF_BUILD ||
  !!process.env.CI;

const adb = path.join(SDK, "platform-tools", "adb");
const emulator = path.join(SDK, "emulator", "emulator");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a command, returning trimmed stdout, or "" on any failure. */
function sh(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function requireSdk() {
  if (!existsSync(adb) || !existsSync(emulator)) {
    console.error(
      `Android SDK not found under ${SDK}\n` +
        `  Set ANDROID_HOME (or ANDROID_SDK_ROOT) to your SDK root.\n` +
        `  Expected: ${adb}\n            ${emulator}`,
    );
    process.exit(1);
  }
}

/** Serial numbers of attached devices actually in "device" state. */
function attachedDevices() {
  return sh(adb, ["devices"])
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial);
}

/** True once Android itself is usable - NOT merely once adb lists the device. */
function isBootCompleted() {
  return sh(adb, ["shell", "getprop", "sys.boot_completed"]).replace(/\r/g, "") === "1";
}

async function boot() {
  requireSdk();

  // Idempotent: a booted device means there is nothing to do. `adb devices`
  // alone is not proof - it reports the device long before Android is usable -
  // so the boot flag is what decides.
  if (attachedDevices().length && isBootCompleted()) {
    console.log(`[android] already booted (${attachedDevices().join(", ")}) - nothing to do`);
    return;
  }

  const available = sh(emulator, ["-list-avds"]).split("\n").filter(Boolean);
  if (!available.includes(AVD)) {
    console.error(
      `AVD "${AVD}" does not exist on this machine.\n` +
        (available.length
          ? `  Available: ${available.join(", ")}\n  Set ANDROID_AVD to one of those.`
          : `  No AVDs at all - create one with avdmanager first.`),
    );
    process.exit(1);
  }

  // GPU mode is not a detail
  // ⚠️ `swiftshader_indirect` is SOFTWARE rendering. It is right on a headless
  // CI agent, which has no usable GPU - and wrong on a developer Mac, where it
  // makes the Pixel launcher too slow to draw and Android puts up a "Pixel
  // launcher isn't responding" ANR dialog moments after boot. That dialog can
  // then steal focus from the app under test.
  //
  // So: host GPU by default, software only when headless. `auto` lets the
  // emulator pick, which on macOS means Metal.
  const args = ["-avd", AVD, "-no-snapshot", "-no-boot-anim"];
  if (HEADLESS) {
    args.push("-no-window", "-gpu", "swiftshader_indirect");
  } else {
    args.push("-gpu", "auto");
  }

  // Detached, with stdio pointed at a log file rather than inherited. Both
  // halves are needed for the emulator to survive this process exiting.
  const logPath = path.join(os.tmpdir(), `emulator-${AVD}.log`);
  const log = openSync(logPath, "a");
  const child = spawn(emulator, args, { detached: true, stdio: ["ignore", log, log] });
  child.unref();

  console.log(`[android] booting ${AVD} (pid ${child.pid}), log: ${logPath}`);

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (attachedDevices().length && isBootCompleted()) {
      // Dismiss the lock screen; harmless when there isn't one.
      sh(adb, ["shell", "input", "keyevent", "82"]);

      // Belt to the GPU fix above: suppress "<app> isn't responding" and crash
      // dialogs outright. Even with hardware rendering a cold-booted emulator
      // can drop enough frames to trip an ANR, and such a dialog sits ON TOP of
      // the app under test - so a test fails with "element not found" while a
      // screenshot shows a system dialog rather than the app. Standard practice
      // on a test device; it changes nothing about the app's own behaviour.
      sh(adb, ["shell", "settings", "put", "global", "hide_error_dialogs", "1"]);

      const secs = Math.round((BOOT_TIMEOUT_MS - (deadline - Date.now())) / 1000);
      console.log(
        `[android] ${AVD} ready after ~${secs}s` +
          (HEADLESS ? " (headless, software GPU)" : " (host GPU)"),
      );
      return;
    }
    await sleep(3000);
  }

  console.error(
    `[android] ${AVD} did not finish booting within ${BOOT_TIMEOUT_MS / 1000}s.\n` +
      `  Emulator log: ${logPath}`,
  );
  process.exit(1);
}

function kill() {
  requireSdk();
  if (!attachedDevices().length) {
    console.log("[android] no device attached - nothing to kill");
    return;
  }
  sh(adb, ["emu", "kill"]);
  console.log("[android] shutdown requested");
}

function status() {
  requireSdk();
  const devices = attachedDevices();
  console.log(`SDK:      ${SDK}`);
  console.log(`AVD:      ${AVD}`);
  console.log(`Devices:  ${devices.length ? devices.join(", ") : "(none)"}`);
  console.log(`Booted:   ${devices.length && isBootCompleted() ? "yes" : "no"}`);
}


/**
 * Create the AVD this framework is verified against - the same one CI builds.
 *
 * Idempotent: an existing AVD of that name is left alone unless RECREATE=true,
 * because deleting one throws away its userdata (installed app, granted
 * permissions) for no gain when the spec already matches.
 *
 * ⚠️ THE ABI IS THE HOST'S, DELIBERATELY. It is the one field that cannot match
 * CI: an emulator running a foreign architecture translates every guest
 * instruction and is unusably slow, so Apple Silicon gets arm64-v8a where CI's
 * Intel agents get x86_64. Everything that changes what a TEST sees - API level,
 * image tag, device profile, screen geometry - is identical.
 */
function create() {
  const avdmanager = path.join(SDK, "cmdline-tools", "latest", "bin", "avdmanager");
  const sdkmanager = path.join(SDK, "cmdline-tools", "latest", "bin", "sdkmanager");
  if (!existsSync(avdmanager)) {
    console.error(`avdmanager not found at ${avdmanager} - is ANDROID_HOME right?`);
    process.exit(1);
  }

  const abi = ["arm64", "aarch64"].includes(os.arch() === "arm64" ? "arm64" : process.arch)
    ? "arm64-v8a"
    : "x86_64";
  const image = `system-images;android-${DEVICE.apiLevel};${DEVICE.imageTag};${abi}`;

  const existing = sh(path.join(SDK, "emulator", "emulator"), ["-list-avds"])
    .split("\n")
    .filter(Boolean);
  if (existing.includes(AVD) && !/^(1|true|yes)$/i.test(process.env.RECREATE || "")) {
    console.log(`[android] ${AVD} already exists - leaving it alone (RECREATE=true to rebuild).`);
  } else {
    if (existing.includes(AVD)) {
      console.log(`[android] RECREATE set - deleting ${AVD}`);
      sh(avdmanager, ["delete", "avd", "-n", AVD]);
    }
    console.log(`[android] installing ${image} (this is a ~700 MB download the first time)`);
    execFileSync(sdkmanager, ["--install", image], { stdio: "inherit" });
    console.log(`[android] creating ${AVD} from ${image} on ${DEVICE.deviceProfile}`);
    execFileSync(avdmanager, ["create", "avd", "-n", AVD, "-k", image, "--device", DEVICE.deviceProfile], {
      input: "no\n",
      stdio: ["pipe", "inherit", "inherit"],
    });
  }

  // ⚠️ APPLIED EVERY TIME, not just on creation - an AVD made before this file
  // existed has the device profile's own geometry, which is NOT what CI runs.
  // Same override the pipeline applies, and the same reason: fewer pixels for a
  // GPU-less agent, and MORE logical room (480x1066 dp against pixel_7's
  // 411x914), so nothing that fitted before stops fitting.
  const config = path.join(os.homedir(), ".android", "avd", `${AVD}.avd`, "config.ini");
  if (!existsSync(config)) {
    console.warn(`[android] no config.ini at ${config} - cannot pin the screen geometry.`);
    return;
  }
  const kept = readFileSync(config, "utf8")
    .split("\n")
    .filter((line) => !/^hw\.lcd\.(width|height|density)=/.test(line) && line.trim() !== "");
  writeFileSync(
    config,
    [
      ...kept,
      `hw.lcd.width=${DEVICE.lcdWidth}`,
      `hw.lcd.height=${DEVICE.lcdHeight}`,
      `hw.lcd.density=${DEVICE.lcdDensity}`,
      "",
    ].join("\n"),
  );
  console.log(
    `[android] ${AVD} pinned to ${DEVICE.lcdWidth}x${DEVICE.lcdHeight} @${DEVICE.lcdDensity}dpi ` +
      `(${Math.round((DEVICE.lcdWidth * 160) / DEVICE.lcdDensity)}x` +
      `${Math.round((DEVICE.lcdHeight * 160) / DEVICE.lcdDensity)} dp) - the same as CI`,
  );
}

const command = process.argv[2] || "boot";
const commands = { boot, kill, status, create };
if (!commands[command]) {
  console.error(`Unknown command "${command}". Use: boot | kill | status | create`);
  process.exit(1);
}
await commands[command]();
