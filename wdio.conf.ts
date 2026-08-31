// ⚠️ .env FIRST, before anything imports config/*, so every secret your test-data
// provider or app credentials need is in process.env by the time requiredEnv()
// looks for one.
//
// `override: false` is the default and the one we want: a variable already set in the
// environment WINS over the file. That is what lets a CI job supply every one of them
// from its own secret store with no .env present at all - the call is simply a no-op
// when the file doesn't exist. See docs/guides/ci.md.
require("dotenv").config();

// ⚠️ ES imports are HOISTED, so every module below runs BEFORE the dotenv call above.
// All of them are safe because none reads an env var at module scope - they read
// inside the functions they export. Check that before adding another one.
import { scaled } from "./test/support/timeouts";
import { capabilitiesFor } from "./config/wdio/capabilities";
import {
  LOG_DIR,
  RESULTS_DIR,
  appiumLogPath,
  clearPreviousResults,
  resultsFileName,
  saveFailureScreenshot,
} from "./config/wdio/artifacts";
import {
  aotCompileApp,
  clearInstalledApp,
  noteNonLatinKeyboards,
  reportAndroidDevice,
} from "./config/wdio/device";
import { orderedSpecs } from "./config/wdio/specOrder";
import { beginRun, recordTest } from "./config/wdio/runRecord";

// Appium is started with `--log <LOG_DIR>/...` and will NOT create the directory
// itself - a missing one fails the server launch, which surfaces as "Appium did not
// start within expected time". Created synchronously at module load rather than in
// onPrepare, because that hook and the service's own run in parallel.
require("fs").mkdirSync(LOG_DIR, { recursive: true });

const platform = (process.env.PLATFORM ?? "ios").toLowerCase();

// ISOLATED=true gives every spec file's session a genuinely fresh app install
// (fullReset) instead of noReset's "keep whatever the last session left". It trades
// a full sign-in per suite - usually the flakiest flow in any app - for atomicity
// guaranteed by Appium rather than by the app.
const isolated = process.env.ISOLATED === "true";

/**
 * Driver round-trips in the test currently running - reset in `beforeTest`, printed
 * in `afterTest`. The only cost figure that carries from a dev machine to a CI agent,
 * because the COUNT is a property of the test while per-call latency differs ~60x.
 */
let driverCalls = 0;

export const config: WebdriverIO.Config = {
  runner: "local",
  tsConfigPath: "./tsconfig.json",
  port: 4723,

  // Authenticated suites first, pre-auth last - see config/wdio/specOrder.ts.
  specs: orderedSpecs(),
  exclude: [],

  // ⚠️ Stays 1. A real Simulator/Emulator can only be driven by one Appium session at
  // a time, so raising this lets spec files race for the same physical UI - confirmed
  // live, it produced a login failure that looked like a selector bug and wasn't.
  maxInstances: 1,
  capabilities: [capabilitiesFor(platform, isolated)],

  // "info" logs every WebDriver command and result, raw base64 screenshots included -
  // useful when actively debugging a selector, and it drowns out the spec reporter's
  // summary for a normal run. The reporters print results either way.
  logLevel: "warn",
  bail: 0,

  // ⚠️ THE MOST IMPORTANT TIMEOUT IN THE REPO: the ceiling every `waitFor*` uses when
  // the caller passes none, which is most of them. An unscaled value here gives the
  // great majority of this framework's waits a dev-machine budget on an agent where a
  // single round-trip can cost 3s instead of 50ms, whatever TIMEOUT_SCALE says. The
  // commit that wrapped 135 raw numbers in scaled() missed this line.
  waitforTimeout: scaled(10000),

  // ⚠️ The ceiling on a single HTTP request to Appium, and the longest by far is POST
  // /session - "compile WebDriverAgent" on iOS, "install three apks and cold-start
  // the app" on Android. Both blew through the 120s default on a hosted agent and
  // reported the useless "The operation was aborted due to timeout".
  //
  // This only has to be LARGER THAN THE SUM of the per-step Appium ceilings in the
  // capabilities, or WebdriverIO hangs up while the driver is still legitimately
  // working - and at 300000 it was not, which is the rule being stated and then
  // broken. Sized per platform: iOS ~1250s (wdaLaunchTimeout 600 x 2 retries + 20s
  // interval + install), Android ~1380s (300 + 300 + 600 + 180). 1800s clears both.
  //
  // ⚠️ IF YOU RAISE wdaLaunchTimeout, RE-DO THAT SUM. A healthy hosted iOS session
  // measured 397s, so this is ~4.5x the real cost rather than a number anything
  // normally approaches. The price is that a wedged session takes 30 minutes to
  // report instead of 5 - accepted, because the failure this prevents is silent and
  // the one it causes is merely slow.
  connectionRetryTimeout: 1800000,

  // ⚠️ 1, not WebdriverIO's default of 3. A retried POST /session starts a SECOND session
  // against a device that can only host one, while the first may still be in flight -
  // and three attempts at these ceilings is 15 minutes per spec file spent failing.
  // One retry still absorbs a genuinely dropped request.
  connectionRetryCount: 1,

  services: [
    [
      "appium",
      {
        // The service's own default is 30s, a developer-machine number. A hosted VM
        // that has just run `npm ci`, switched Xcode and booted a Simulator is
        // nowhere near idle, and when it blew this the onPrepare hook failed and
        // every session afterwards got ECONNREFUSED.
        appiumStartTimeout: 120000,
        // ⚠️ Appium's own `--log` flag, NOT the service's `logPath` option and NOT
        // `args.logLevel`. `logPath` only starts piping after _startAppium() resolves,
        // so a startup failure published an empty artifact - the one failure that
        // needed a log. `args.logLevel` suppresses the "listener started" line the
        // service watches for and breaks launch detection outright.
        args: { log: appiumLogPath(platform) },
      },
    ],
  ],

  framework: "mocha",

  // ⚠️ FOR A WEDGED WebDriverAgent, NOT FOR A FLAKY TEST. WDA stops answering
  // part-way through a long run and every remaining command in that session dies on
  // the Appium-to-WDA proxy's 240s ceiling. Measured: one spec, as the EIGHTH spec
  // file of a run, failed three times over and cost 26 minutes of a 57-minute run -
  // then passed 8/8 in 1m38s on its own, same commit, same simulator. Appium reuses
  // one WDA across every spec file, so nothing a spec can do recovers it from inside
  // - and since maxInstances is 1, a spec-file retry IS "run this against a fresh
  // session".
  //
  // It softens no assertion: a real failure fails both attempts and still reports.
  // ⚠️ If a retry starts rescuing the same spec every run, that spec has a bug.
  //
  // ⚠️ KEPT AT 1 DELIBERATELY, AND THE CASE FOR 0 IS REAL. Retrying a spec that is
  // NOT IDEMPOTENT manufactures failures the first attempt did not have: whatever it
  // created and did not remove is still there on the second pass, so a suite that
  // counts rows or asserts a folder is empty now reports several failures descending
  // from one leftover. In the predecessor project that misread as a 4-failure
  // regression more than once.
  //
  // It is still the wrong trade: the WDA wedge above is measured and unrecoverable
  // from inside a spec, and dropping retries costs a whole run when it hits. What was
  // actually wrong was that the retry DESTROYED attempt 1's XML, so the manufactured
  // failures were the only copy left - fixed in config/wdio/artifacts.ts, which now
  // writes a retry to `.attempt2.xml` and leaves attempt 1 alone. Rule 10 is the
  // other half: read the FIRST attempt's failure.
  //
  // If one of your suites is non-idempotent, the durable fix is a fixture that can
  // undo one item rather than only the whole run - see docs/architecture/test-data.md.
  specFileRetries: 1,
  // ⚠️ NOT deferred, which is the opposite of what it first looks like. Deferring
  // would retry the spec at the END of the queue, and the spec ORDER is load-bearing:
  // a deferred retry of an authenticated spec would land after the ones that sign
  // out and pay a full sign-in to recover from an unrelated wedge. Immediate is
  // also enough - creating a session health-checks WDA and relaunches it.
  specFileRetriesDeferred: false,

  reporters: [
    "spec",
    [
      "junit",
      {
        outputDir: RESULTS_DIR,
        // The platform is in the name - see config/wdio/artifacts.ts.
        outputFileFormat: (options: { cid: string }) =>
          resultsFileName(platform, options.cid),
      },
    ],
  ],

  mochaOpts: {
    ui: "bdd",
    // The per-test ceiling Mocha applies when a suite has not set its own. Every
    // describe() in test/specs/ does, so this is the safety net rather than the main
    // control - but a safety net that does not scale is not one.
    timeout: scaled(90000),
  },

  /**
   * Run-level setup, before any worker starts.
   *
   * onPrepare/onComplete run once, in the main process, with NO DEVICE ATTACHED -
   * which is exactly right for test data, because seeding and deleting are
   * database/API work. Every suite then shares whatever this seeded.
   * See test/support/testData.ts.
   */
  onPrepare: async function (preparedConfig: WebdriverIO.Config) {
    await reportAndroidDevice();

    // ⚠️ BEFORE ANY WORKER WRITES A RESULT. resultsFileName() tells a retry apart
    // from a first attempt by asking whether the file is already on disk, so this
    // platform's leftovers from a previous run have to be gone first - otherwise
    // attempt 1 gets named `.attempt2` and the retry looks like the original.
    //
    // ⚠️ ONLY WHEN THIS RUN ACTUALLY WRITES JUnit XML, and that guard is the whole
    // reason this is not an unconditional call. wdio.explore.conf.ts spreads this
    // config to inherit onPrepare's fixture, and overrides `reporters` to ["spec"] -
    // it writes no XML at all. Unguarded, running one charter deleted a finished
    // regression's results, which is far worse than the overwrite this was added to
    // prevent. Measured the same day it was written.
    const writesJUnit = (preparedConfig?.reporters ?? []).some(
      (reporter) => (Array.isArray(reporter) ? reporter[0] : reporter) === "junit",
    );
    if (writesJUnit) clearPreviousResults(platform);

    // One clean record file per run, for `npm run report`. Same moment as the
    // JUnit reset so a report can never mix two runs together.
    beginRun(platform);

    // ⚠️ START EVERY RUN FROM AN APP WITH NO SESSION. If your provider deletes the
    // account it seeded, then without this the next run inherits a session belonging
    // to an account that no longer exists, and the first spec has to recover mid-run
    // - the most fragile thing here. Measured across three runs on a real suite: the
    // first two or three spec files failed in their `before` hooks every time, while
    // every spec from the fourth onwards passed. The flakiness was not random, it
    // was inherited state.
    //
    // onComplete now clears up after itself too; this is the belt to that braces, for
    // a ctrl-C'd run, a crashed worker, or an app someone signed into by hand.
    await clearInstalledApp("starting from no session");
    await noteNonLatinKeyboards();

    // Seed whatever the whole run shares. With the default "none" provider this
    // is a no-op; see test/support/testData.ts to plug a real one in.
    const { testData } = await import("./test/support/testData");
    await (await testData()).setUp?.();
  },

  /**
   * Tear down whatever the run seeded, once every suite has finished - pass or fail.
   */
  onComplete: async function () {
    // ⚠️ ORDER MATTERS: drop the session BEFORE deleting the account. If the app is
    // still holding a token whose identity you are about to delete, the next launch
    // can render a blank screen and never reach any resting state - and relaunching
    // does not help, because the token is persisted. Doing it here, while the account
    // still exists, is the equivalent of logging out, at the one point in the
    // lifecycle that can still act on the device.
    //
    // Its own try/catch, and first: whatever happens to the device, the data
    // deletion below must still be attempted, because that is the step that leaves
    // residue on a shared database.
    try {
      await clearInstalledApp("run finished - device left with no session");
    } catch (error) {
      console.error("Could not clear the app after the run:", error);
    }

    try {
      const { testData } = await import("./test/support/testData");
      await (await testData()).tearDown?.();
    } catch (error) {
      console.error(
        "TEST DATA CLEANUP FAILED - check your environment by hand:", error,
      );
    }
  },

  beforeCommand: function () {
    driverCalls += 1;
  },

  beforeTest: function () {
    driverCalls = 0;
  },

  /**
   * Screenshot a FAILED HOOK - which `afterTest` cannot do, because it never runs for
   * one.
   *
   * ⚠️ This is the gap that cost a CI run a full round-trip to diagnose: a `before
   * all` died during sign-in and the published errorShots artifact held nothing but
   * its .keep file. The answer was a permission dialog sitting in front of the app,
   * which one image would have shown instantly. Hook failures are the
   * framework's most common CI failure by some margin - a `before all` covers sign-in,
   * seeding and app recovery - so this is where a screenshot is worth the most.
   */
  afterHook: async function (test, _context, { error }, hookName) {
    if (!error) return;
    await saveFailureScreenshot(`HOOK-${hookName}-${test.title ?? ""}`, platform);
  },

  before: async function () {
    await aotCompileApp();
  },

  afterTest: async function (test, _context, { passed, error, duration }) {
    // ⚠️ The one figure about this suite that means THE SAME THING on both machines.
    // A round-trip is ~50ms on a dev machine and ~3s on a hosted agent, so a local
    // duration predicts nothing about CI, and CI's own durations vary ~3x
    // between identical runs. The CALL COUNT does not vary.
    //
    // It deliberately does not project a duration: measured across one CI run, the
    // implied constant was 0.5s per call for a small test and 2.7s for a large-list
    // one, because a `$$` across 98 elements costs many times what a small lookup
    // does.
    //
    // ⚠️ Counts the test BODY only. beforeTest runs AFTER Mocha's beforeEach, so a
    // suite that navigates and scrolls there is not paying for it in these figures -
    // compare tests with each other, and expect the suite total to exceed their sum.
    const calls = driverCalls;
    console.log(
      `[cost] ${calls} driver calls | ${test.title}` +
        (calls >= 1000 ? "  ⚠️ FOUR FIGURES - suspect a per-member loop" : ""),
    );

    // The same figures, machine-readable, so `npm run report` can rebuild this
    // run after the terminal has scrolled. See config/wdio/runRecord.ts.
    recordTest(platform, {
      title: test.title,
      suite: test.parent ?? "",
      file: (test.file ?? "").replace(`${process.cwd()}/`, ""),
      passed,
      calls,
      // ⚠️ From the RESULTS argument, not from `test`. Mocha has not written
      // the duration onto the test object yet at this point, so reading it there
      // records 0 for every test and the report shows a run that took no time.
      durationMs: duration ?? 0,
      // ⚠️ NOT just the first line. An expect() message puts the assertion on
      // line 1 and the actual value two lines below it, so `split("\n")[0]`
      // records "expect(received).toBeNull()" and throws away `Received: "you
      // sure"` - the only part that says what went wrong.
      error: passed
        ? undefined
        : ((error as { message?: string })?.message ?? String(error ?? ""))
            .split("\n")
            .filter((line) => line.trim())
            .slice(0, 3)
            .join("\n"),
      at: new Date().toISOString(),
    });

    // Errorshot on failure. Rule 11: check errorShots/ before re-diagnosing from an
    // error message - the picture usually settles it in seconds.
    if (!passed) await saveFailureScreenshot(test.title, platform);

    // ⚠️ Print the failure as PLAIN TEXT, because a real one once arrived unreadable:
    // `Converting circular structure to JSON ... property 'error' closes the circle`,
    // in place of whatever actually went wrong. The circularity is hit while the
    // failure is being SERIALISED for reporting, and the original message is lost with
    // it. A message and a stack are plain strings and cannot round-trip into that, so
    // writing them here means the next occurrence is diagnosable whatever the reporter
    // does with the object. (The upstream half is patches/@wdio+utils+*.patch.)
    if (!passed && error) {
      const err = error as { message?: string; stack?: string };
      console.log(`[failed] ${test.title}`);
      console.log(`[failed]   ${err.message ?? String(error)}`);
      // The first few frames only - a full wdio stack is mostly node internals.
      for (const frame of (err.stack ?? "").split("\n").slice(1, 6))
        console.log(`[failed]   ${frame.trim()}`);
    }

    // Per-test cleanup, pass or fail, so runs don't leave orphaned records behind.
    // A no-op under the default "none" provider.
    try {
      const { testData } = await import("./test/support/testData");
      await (await testData()).afterEachTest?.();
    } catch {
      /* best-effort - never fail a test because cleanup failed */
    }

    // ⚠️ ONE FAILURE MUST NOT COST THE WHOLE SUITE. Measured: one test hit the Mocha
    // ceiling with a list expanded, and the next three failed reading a screen nobody
    // had put back (`expected "Show All (98)", got "Show less"`). None of those three
    // was the bug. A Mocha timeout is the worst case - it abandons the
    // test but the driver commands it left in flight keep running, so the next test's
    // own beforeEach races them and a spec-level guard cannot fix it from inside.
    //
    // Deliberately a relaunch and not a reinstall: it resets navigation, scroll and
    // modal state - what actually leaks - while keeping the signed-in session the run
    // pays for once.
    if (!passed) {
      try {
        // ⚠️ OUR app by id, not "the active app": after a failure the thing in front
        // may be a system permission dialog, and relaunching THAT leaves our app dead.
        const { relaunchOurApp } = await import("./test/support/session");
        await relaunchOurApp();
        console.log("[recover] relaunched the app after a failure - next test starts clean");
      } catch (e) {
        // The driver itself may be gone. The next spec gets a fresh session anyway.
        console.log(`[recover] could not relaunch after the failure: ${String(e)}`);
      }
    }
  },

  /**
   * Cheap suite isolation for the default (non-ISOLATED) mode: force-relaunch the app
   * so the NEXT spec file gets a fresh process, and with it a fresh navigation and
   * scroll state. Those two were the real cross-suite bugs - a screen left scrolled
   * to the bottom, the active tab persisting - and a relaunch fixes both.
   *
   * ⚠️ IT DELIBERATELY DOES NOT LOG OUT. It used to, and that was the most expensive
   * thing in the run for no benefit: every suite shares one account, so a re-login
   * establishes nothing the surviving session did not - and signing in straight after
   * an in-app logout is the worst case of the flakiest flow in the app.
   *
   * Skipped under ISOLATED=true, where fullReset already guarantees a clean slate at
   * the start of the next session.
   */
  afterSuite: async function () {
    if (isolated) return;

    try {
      // ⚠️ OUR app by id. This runs after the LAST test of a spec file, including one
      // that failed or a hook that died, so the foreground app is not guaranteed to be
      // ours - a system permission dialog once got relaunched instead, and the next
      // spec opened onto a dead app.
      const { relaunchOurApp } = await import("./test/support/session");
      await relaunchOurApp();
    } catch {
      /* best-effort - nothing more to do if the app or driver is gone */
    }
  },
};
