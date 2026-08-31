#!/usr/bin/env node
/**
 * ONE DEVICE, ONE SESSION - arbitrated, instead of remembered.
 *
 * ===================== WHY =====================
 * A real Simulator or emulator can be driven by exactly one Appium session.
 * `maxInstances: 1` enforces that INSIDE one wdio process and says nothing about
 * two processes - two terminals, two Claude sessions, an agent starting a run
 * while a regression is going. Two sessions on one device do not error; they
 * INTERLEAVE. Taps land on the other session's screen and the failures read like
 * selector bugs. docs/history/experiments.md records one that cost real
 * debugging: a spurious login failure that looked like a selector bug and wasn't.
 *
 * Until now the only mechanism was a person remembering to say so. That does not
 * survive agents that start their own runs.
 *
 * ⚠️ THIS CANNOT CHANGE WHAT A TEST SEES. It touches no driver call, no selector,
 * no timeout and no fixture. The only thing it can do wrong is refuse to start a
 * run that should have started - a failure at t=0, naming the holder, never a
 * failure mid-run.
 *
 *   npm run device:status
 *   node scripts/device-lock.mjs run --owner "regression ios" -- npm run wdio:ios
 *   node scripts/device-lock.mjs acquire --owner "explore" --wait 900
 *   node scripts/device-lock.mjs release
 *
 * `run` is the form the npm scripts use: it acquires, runs, and releases in a
 * finally, so a failing or interrupted command still gives the lock back.
 *
 * ===================== ESCAPE HATCHES =====================
 *   DEVICE_LOCK=off      bypass entirely. Logs loudly. Same shape as
 *                        ANDROID_ALLOW_UNACCELERATED / RUN_CI_EXCLUDED.
 *   CI / TF_BUILD set    automatic no-op. A hosted agent has one device and no
 *                        contention, so the lock would be pure downside - and this
 *                        deliberately adds no new failure mode to a CI job.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const LOCK = path.join(process.cwd(), ".device-lock.json");
/** A backstop only - the PID check below is what actually retires a dead lock. */
const TTL_MS = 6 * 60 * 60 * 1000;
/** @wdio/appium-service's default, and what wdio.conf.ts sets explicitly. */
const APPIUM_PORT = Number(process.env.APPIUM_PORT ?? 4723);

const BYPASS = process.env.DEVICE_LOCK === "off";
const IS_CI = Boolean(process.env.CI || process.env.TF_BUILD);
const log = (m) => console.log(`[device-lock] ${m}`);

/**
 * The current holder, or null - clearing the record if it is no longer real.
 *
 * ⚠️ `kill -0` FIRST, TTL second. One CI run spent 35 minutes waiting on a device
 * whose emulator had died two seconds in; the lesson is to check whether the thing
 * you are waiting for still exists. A dead holder is retired instantly, not in six
 * hours.
 */
function readLock() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(LOCK, "utf8"));
  } catch {
    return null;
  }
  try {
    process.kill(raw.pid, 0);
  } catch {
    log(`clearing a stale lock - pid ${raw.pid} (${raw.owner}) is gone`);
    fs.rmSync(LOCK, { force: true });
    return null;
  }
  if (Date.now() - new Date(raw.startedAt).getTime() > TTL_MS) {
    log(`clearing a lock older than ${TTL_MS / 3600000}h - pid ${raw.pid} (${raw.owner})`);
    fs.rmSync(LOCK, { force: true });
    return null;
  }
  return raw;
}

/**
 * Is something already listening on Appium's port?
 *
 * ⚠️ THE LOCK ONLY COORDINATES WHAT TAKES IT. A hand-typed `npx wdio run`, Appium
 * Inspector, or a run started before this existed is invisible to the lockfile -
 * and this catches all three. A WARNING, never a refusal: a leftover Appium server
 * with no session attached is common and harmless, and refusing on it would make
 * the lock worse than the problem it solves.
 */
function appiumListening(timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: APPIUM_PORT, host: "127.0.0.1" });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

const describeHolder = (h) =>
  `${h.owner} (pid ${h.pid}${h.platform ? `, ${h.platform}` : ""}) since ${new Date(h.startedAt).toLocaleTimeString()}`;

async function acquire({ owner, waitSeconds }) {
  if (BYPASS) {
    log("⚠️ DEVICE_LOCK=off - NOT taking the lock. Two sessions on one device interleave silently.");
    return true;
  }
  if (IS_CI) return true;

  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const held = readLock();
    if (!held || held.pid === process.pid) break;
    if (Date.now() >= deadline) {
      log(`device BUSY - held by ${describeHolder(held)}`);
      log(`  queue for it:  <command> --wait 900`);
      log(`  inspect:       npm run device:status`);
      log(`  override:      DEVICE_LOCK=off <command>   (only if you know the holder is wrong)`);
      return false;
    }
    log(`waiting for ${describeHolder(held)} - ${Math.round((deadline - Date.now()) / 1000)}s left`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (await appiumListening())
    log(
      `⚠️ something is listening on :${APPIUM_PORT} while nothing holds the lock - an un-locked ` +
        `run, Appium Inspector, or a leftover server. Check before relying on this run.`,
    );

  fs.writeFileSync(
    LOCK,
    JSON.stringify(
      {
        pid: process.pid,
        owner,
        platform: process.env.PLATFORM ?? null,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  log(`acquired by "${owner}" (pid ${process.pid})`);
  return true;
}

function release({ force = false } = {}) {
  if (BYPASS || IS_CI) return;
  const held = readLock();
  if (!held) return;
  if (held.pid !== process.pid && !force) {
    log(`not releasing - the lock belongs to ${describeHolder(held)}`);
    return;
  }
  fs.rmSync(LOCK, { force: true });
  log("released");
}

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const [cmd = "status"] = process.argv.slice(2);
const owner = flag("owner", `shell@${process.ppid}`);
const waitSeconds = Number(flag("wait", 0)) || 0;

if (cmd === "status") {
  const held = readLock();
  console.log(held ? `HELD by ${describeHolder(held)}` : "free");
  if (await appiumListening()) console.log(`note: something is listening on :${APPIUM_PORT}`);
  if (BYPASS) console.log("note: DEVICE_LOCK=off - the lock is bypassed here");
  if (IS_CI) console.log("note: CI detected - the lock is a no-op here");
} else if (cmd === "acquire") {
  process.exit((await acquire({ owner, waitSeconds })) ? 0 : 3);
} else if (cmd === "release") {
  release({ force: process.argv.includes("--force") });
} else if (cmd === "run") {
  const sep = process.argv.indexOf("--");
  if (sep === -1) {
    console.error('usage: device-lock.mjs run --owner "…" [--wait N] -- <command…>');
    process.exit(2);
  }
  const argv = process.argv.slice(sep + 1);
  if (!(await acquire({ owner, waitSeconds }))) process.exit(3);

  // Give the lock back on EVERY exit path, ctrl-C included. A lock that outlives
  // its own run is the only failure this script can actually inflict on you.
  let released = false;
  const giveBack = () => {
    if (!released) {
      released = true;
      release();
    }
  };
  process.on("exit", giveBack);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(sig, () => {
      giveBack();
      process.exit(130);
    });

  // ⚠️ PUT node_modules/.bin ON THE CHILD'S PATH. `npm run` does this for its own
  // scripts, so `wdio …` resolves there and not when this script is invoked
  // directly - which is exactly how an agent invokes it. Without it the child dies
  // with `spawn wdio ENOENT`, which reads like a broken lock and is a missing PATH.
  const binDir = path.join(process.cwd(), "node_modules", ".bin");
  const child = spawn(argv[0], argv.slice(1), {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
  });
  child.on("error", (e) => {
    giveBack();
    console.error(`[device-lock] could not start: ${e.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    giveBack();
    process.exit(signal ? 130 : (code ?? 1));
  });
} else {
  console.error(`unknown command "${cmd}" - status | acquire | release | run`);
  process.exit(2);
}
