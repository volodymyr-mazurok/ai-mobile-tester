/**
 * Appium capabilities, per platform.
 *
 * ⚠️ EVERY env read here happens INSIDE a function, never at module scope. An ES
 * import is hoisted, so module-scope code in this file would run before
 * wdio.conf.ts's `require("dotenv").config()`. Keep it that way.
 *
 * Most of the non-obvious numbers exist because a hosted CI agent is nothing like a
 * dev machine: it compiles WebDriverAgent from scratch, and its Android emulator may
 * get a single vCPU. The shape of the local-versus-CI gap is in
 * docs/architecture/performance.md.
 */
import { APP } from "../app";
import { inPipeline, pipelineVar } from "./pipelineVar";

export function iosCapabilities(isolated: boolean) {
  return {
    platformName: "iOS",
    "appium:deviceName": process.env.IOS_DEVICE_NAME ?? "iPhone 16e",
    "appium:platformVersion": process.env.IOS_PLATFORM_VERSION ?? "26.3",
    "appium:automationName": "XCUITest",

    // deviceName + platformVersion is a QUERY, and on a CI image it is not a unique
    // one - one agent had five simulators named "iPhone 16e", one per runtime. The
    // pipeline boots a device and passes its udid so Appium drives that one instead
    // of re-resolving the pair and possibly booting a second simulator. Absent
    // locally, where the name/version pair really is unique.
    ...(pipelineVar("IOS_UDID") ? { "appium:udid": pipelineVar("IOS_UDID") } : {}),

    // ⚠️ Without this the driver SHUTS DOWN a headlessly-booted simulator and boots
    // it again inside POST /session. `Simulator.run()` defaults to isHeadless:
    // false, which means "make sure the Simulator.app WINDOW is up", not "boot it if
    // it isn't running" - so our pre-booted device took the one branch nobody wants
    // and a CI job's 239s boot was thrown away. Set by a CI job only; a dev
    // Mac wants the window, and locally there is no pre-boot step to adopt.
    ...(process.env.IOS_HEADLESS === "true" ? { "appium:isHeadless": true } : {}),

    // Where a CI job that pre-builds WebDriverAgent put its build products, so the
    // session's own xcodebuild finds them warm. Absent locally.
    ...(pipelineVar("WDA_DERIVED_DATA_PATH")
      ? { "appium:derivedDataPath": pipelineVar("WDA_DERIVED_DATA_PATH") }
      : {}),

    "appium:app": APP.ios.app,
    "appium:noReset": !isolated,
    "appium:fullReset": isolated,
    // Auto-dismiss system dialogs (the push-notification prompt on first launch)
    // so they don't block element interactions. ⚠️ IT ALSO EATS THE APP'S OWN
    // NATIVE ALERTS, silently - which is one of the four framework artefacts rule
    // 13 says to rule out before filing a finding. A test that needs to assert on
    // an alert has to read the effect instead (the clipboard, the resulting
    // screen), or turn this off for that suite.
    "appium:autoAcceptAlerts": true,
    // Not a per-command ceiling: it kills the SESSION if no new command arrives in
    // time. The stock 60s is shorter than several legitimate single commands here
    // (an app install measured 87s), and the fixture does real non-driver work
    // between commands - seeding, uploading, polling an external mailbox.
    "appium:newCommandTimeout": 600000,

    // Three per-call costs, all of which matter far more in CI than locally: a dev
    // Mac reaches quiescence at once, while a hosted agent sharing 4 cores with a
    // GPU-less Simulator pays the settling wait in full before every command.
    // Verified against appium-xcuitest-driver 10.26.0's desired-caps.js.
    //
    // Deliberately NOT `waitForQuiescence: false`, which removes the wait rather
    // than bounding it - the bigger speed-up and the real flakiness risk.
    "appium:waitForIdleTimeout": 2000,

    // ⚠️ A WEDGED `clear` COSTS FOUR MINUTES, AND A HEALTHY ONE COSTS 370ms.
    //
    // Three times in one day a `POST /element/<id>/clear` against a hosted-login WebView
    // field stopped answering, and each one cost the full proxy timeout - 240000ms,
    // which is @appium/base-driver's JWProxy DEFAULT_REQUEST_TIMEOUT, applied here
    // because `wdaConnectionTimeout` is unset. The fill ladder then retries, so a
    // single wedge burned ~8 minutes and killed the session anyway. It hit both a
    // full regression and a single-spec run on a freshly installed WDA, so it is not
    // the "one WDA degrades over a long run" problem `useNewWDA` covers.
    //
    // Measured over a clean run's 43 clears: max 1009ms, mean 370ms. So a clear that
    // has not answered in 30 SECONDS is wedged, not slow - 30x the worst healthy one.
    //
    // ⚠️ PER-COMMAND, NOT GLOBAL, and that distinction is load-bearing: the slowest
    // legitimate call in the same run was an 83.7-SECOND `setValue` that returned 200
    // (the hosted-login typing fallback). Lowering `wdaConnectionTimeout` globally to anything
    // useful would have killed that successful fill. Only `clear` is bounded.
    //
    // On timeout the driver cancels the request and shuts the session down with
    // "Appium did not get any response from 'clear' command in 30000 ms" - which is
    // what we want: waitForAppReadyOrRecover()'s relaunch ladder and specFileRetries
    // already recover from a dead session, and they can now start doing so 4 minutes
    // sooner.
    //
    // ⚠️ IT IS NOT A `clear` BUG - IT LANDS ON WHATEVER IS IN FLIGHT. The first
    // version of this bounded `clear` alone, on three days' evidence. The very next
    // full run wedged TWICE on `click` instead, at 240011ms and 240007ms - while the
    // clear ceiling worked perfectly and was applied to all 20 clears without ever
    // firing. So the stall is a property of WebDriverAgent, not of one endpoint, and
    // bounding endpoints one at a time is whack-a-mole.
    //
    // What the two cheap commands have in common is the shape of their distribution,
    // and it is what makes an aggressive ceiling safe:
    //
    //   click   446 calls   healthy max   953 ms   + two at 240,0xx ms
    //   clear    20 calls   healthy max   970 ms   + none
    //
    // A second of headroom becomes thirty. Nothing legitimate lives between 1s and
    // 30s for either of them, and the wedges sit exactly on the proxy wall.
    //
    // `default` is the general answer, and it has to stay well above the EXPENSIVE
    // commands: the slowest legitimate call yet measured is an 83.7-second `setValue`
    // that returned 200 (a hosted-login typing fallback), so 120s locally. ⚠️ NOT IN
    // CI, where a single legitimate call has been recorded at 121s (a scoped `$$`
    // over a large list) - there the stock 240s stands.
    //
    // On timeout the driver cancels the request and shuts the session down with
    // "Appium did not get any response from '<cmd>' command in <n> ms", which
    // waitForAppReadyOrRecover()'s ladder and specFileRetries already recover from.
    //
    // Verified against appium-xcuitest-driver 10.26.0: `commandTimeouts` is declared
    // with no type constraint, normalised by normalizeCommandTimeouts() from this
    // JSON string, and applied in commands/proxy-helper.js. The command names are the
    // ones the driver logs as "matched command name".
    "appium:commandTimeouts": JSON.stringify({
      clear: 30000,
      ...(inPipeline() ? {} : { default: 120000 }),
    }),

    // ⚠️ AND `commandTimeouts` CANNOT REACH A DIRECTLY-PROXIED ROUTE, WHICH IS WHY
    // THIS IS HERE TOO. Two attempts at bounding `click` through commandTimeouts did
    // nothing at all, and the driver log says exactly why - the two routes take
    // different paths through the driver:
    //
    //   clear →  "Calling AppiumDriver.clear()" → executeCommand → proxyCommand()
    //            → _getCommandTimeout() applies.        ✅ 20/20 clears bounded
    //   click →  "Driver proxy active, passing request on via HTTP proxy"
    //            → proxyReqRes, straight through JWProxy, never touching
    //              proxyCommand → _getCommandTimeout is never consulted.  ❌
    //
    // So for a proxy-avoided route the ONLY ceiling is the JWProxy's own, which is
    // `wdaConnectionTimeout` - unset, so @appium/base-driver's 240000ms default
    // applied. That is the number in every "Could not proxy command ... timeout of
    // 240000ms exceeded" this framework has ever logged.
    //
    // ⚠️ 60000 WAS TRIED AND REVERTED over one full run. At 60s a test could absorb
    // three stalls instead of one, so it was worth measuring. It cost a whole spec:
    // an in-app `setValue` lost to the ceiling on BOTH attempts. That run had ZERO
    // WebView stalls, so the tighter bound bought nothing.
    //
    // The lesson is that a slow `setValue` is NOT only a WebView phenomenon - an
    // ordinary in-app composer does it too, which the 83.7-second outlier had been
    // assumed to rule out. 120s stands.
    //
    // 120000 is the same bound as the default above and for the same reason: the
    // slowest legitimate call measured is an 83.7-second `setValue` that returned
    // 200. ⚠️ LOCAL ONLY - CI has a recorded legitimate 121-second call (a scoped
    // `$$` over a large list), and this bounds every proxied request including it.
    ...(inPipeline() ? {} : { "appium:wdaConnectionTimeout": 120000 }),
    "appium:reduceMotion": true,
    // XCTest's per-step screenshots are pure overhead: a failing test's screenshot
    // comes from our own afterTest hook, so nothing reads these.
    "appium:disableAutomaticScreenshots": true,

    // ⚠️ WDA is COMPILED, not shipped, and a hosted agent keeps nothing between
    // runs - so a CI session pays a full xcodebuild where a dev Mac reuses warm
    // DerivedData. The stock 60s is a local-machine number.
    //
    // The real fix is a CI pre-build step, not this number: the timeout
    // starts when the driver spawns xcodebuild and covers build AND install AND
    // launch in ONE window, so a cold compile inside it fails deterministically.
    // 600000 rather than 300000 because even WITH the pre-build, WDA has been
    // measured starting at 363s - install and launch on the simulator is ~300s of
    // that on a 4-core agent, and no pre-build removes it.
    //
    // Deliberately NOT `usePrebuiltWDA: true`: that skips build-for-testing
    // entirely and makes the session depend on xcodebuild locating a matching
    // .xctestrun file. Letting the build run and find nothing to do cannot miss.
    "appium:wdaLaunchTimeout": 600000,
    "appium:wdaStartupRetries": 2,
    "appium:wdaStartupRetryInterval": 20000,

    // ⚠️ ONE WDA shared across a whole run DEGRADES, and by the seventh spec file
    // it stops answering - one spec lost both attempts in that position and
    // passed 7/7 as the 2nd, same commit, same simulator. A spec-file retry cannot
    // help: it opens a new session against the same tired WDA.
    //
    // GATED TO LOCAL on purpose. useNewWDA reinstalls WDA per session: seconds on a
    // dev Mac, ~300s on a hosted agent, so eight of them would add ~40 minutes to a
    // job that already runs 4-5 hours. The CI half is therefore unverified - measure
    // per-session WDA cost before enabling it there.
    //
    // The check is inPipeline() rather than ciExclusions.inCI(), because that helper
    // is deliberately falsified by RUN_CI_EXCLUDED=true and would switch this on for
    // exactly the pipeline run that asked for the excluded tests.
    ...(inPipeline() ? {} : { "appium:useNewWDA": true }),
  };
}

export function androidCapabilities(isolated: boolean) {
  return {
    platformName: "Android",
    "appium:deviceName": process.env.ANDROID_DEVICE_NAME ?? "Android Emulator",
    "appium:automationName": "UiAutomator2",
    "appium:app": APP.android.app,
    "appium:noReset": !isolated,
    "appium:fullReset": isolated,
    "appium:chromedriverAutodownload": true,
    // Grant permissions at install time instead of having to dismiss runtime
    // dialogs - one of which once ended up in front of the app and made
    // relaunchActiveApp() restart the permission controller.
    "appium:autoGrantPermissions": true,
    // See the iOS note: this kills the session, not the command. The stock 60s
    // expired mid-`install_app` and every command after it failed with `invalid
    // session id`, which reads like a crashed driver and is a self-inflicted
    // timeout.
    "appium:newCommandTimeout": 600000,

    // ⚠️ Creating a UiAutomator2 session is not one operation - it installs
    // io.appium.settings, the UiAutomator2 server AND its test apk, then our apk,
    // starts the instrumentation and cold-starts the app. Each has its own ceiling,
    // and all of them are sized for a developer's machine.
    //
    // These are CEILINGS, not waits: a fast emulator never notices them. They are
    // this large because a hosted agent's emulator can get ONE vCPU (the emulator
    // refuses more below six logical cores), where boot measured 864s, our apk 87s,
    // and the 5 MB UiAutomator2 server timed out past 120s.
    "appium:uiautomator2ServerInstallTimeout": 300000,
    "appium:uiautomator2ServerLaunchTimeout": 300000,
    "appium:androidInstallTimeout": 600000,
    "appium:adbExecTimeout": 300000,
    // Cold start on a fresh install is 20-30s+ even locally, and the stock
    // appWaitDuration is 20s.
    "appium:appWaitDuration": 180000,
    // Animations are dead time UiAutomator2 waits out. The pipeline turns them off
    // device-side too; this covers a local emulator nobody configured.
    "appium:disableWindowAnimation": true,

    // ⚠️ Without this, EVERY element lookup failed on a CPU-starved emulator with
    // "Timed out waiting for the root AccessibilityNodeInfo in the active window" -
    // the driver naming its own fix. UiAutomator2's default XPath2 engine first
    // serialises the whole window into a DOM, which never completes; XPath1 walks
    // the node tree directly. This framework is ALL XPath, so it is every lookup
    // the suite makes.
    //
    // Passed as an initial driver setting so it applies from the first command,
    // without a spec having to call updateSettings.
    "appium:settings": {
      enforceXPath1: true,
    },
  };
}

export function capabilitiesFor(platform: string, isolated: boolean) {
  return platform === "android" ? androidCapabilities(isolated) : iosCapabilities(isolated);
}
