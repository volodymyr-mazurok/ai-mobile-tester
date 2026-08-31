# AI Mobile QA Boilerplate

**A mobile E2E framework built to be driven by an AI agent, not just by a person.**

WebdriverIO + Appium underneath. The point is the loop on top:

```
build → run → explore → report → decide
```

Claude captures a screen, declares it as a page object, writes the spec, runs the
suite, triages what went red, explores where the suite does not go, and reports.
A person sets direction and reviews the output. Nothing runs on a schedule and
nothing is committed automatically.

---

## Two branches

| branch | what it is |
|---|---|
| **`main`** (you are here) | the boilerplate. No app, no specs, no findings - the framework and its rules, ready to point at your app. |
| **`demo`** | the same framework already wired to a real app, with requirements, two suites, an exploratory charter and a real bug it finds. Runs in four commands. |

**Start on `demo` if you want to see it work.** It fetches Sauce Labs' *My Demo App
RN* from the vendor's own release (pinned and checksummed - the binary is not
committed here), runs 16 tests and finds a genuine copy defect in the app:

```bash
git switch demo
npm install && npm run setup
npm run wdio:android      # 15 pass, 1 red - and the red one is a real bug
```

**Stay on `main` if you are adopting it.** Nothing runs until you point it at an app:

```bash
npm install               # postinstall applies patches/ - don't skip it
# put your .apk / .app in apps/, then edit the three files below
npm run android:boot
npm run wdio:android
```

## Pointing it at your app - three files

| file | what it holds |
|---|---|
| `config/app.ts` | ids, binaries, auth strategy, test-data provider |
| `test/pageobjects/app.contract.ts` | how the framework asks *your* app "are you ready / signed out" |
| `test/pageobjects/screens.ts` | your screens, and how to reach each one |

Nothing else hardcodes an app id.

```ts
// config/app.ts - replace the placeholders
export const APP: AppDefinition = {
  name: "My App",
  android: { id: "com.example.app", activity: ".MainActivity", app: "./apps/app.apk" },
  ios:     { id: "com.example.app", app: "./apps/app.app" },
  auth:    { strategy: "in-app" },   // | "webview" | "none"
  testData:{ provider: "none" },     // | "./test/support/myProvider"
};
```

## What you actually get

**The architecture** - `ActionHelper` + declarative `Component` trees. A spec never
sees a selector:

```ts
ActionHelper.setCurrentPage(Catalog);
await ActionHelper.click("Sort Button");
const price = await ActionHelper.getText("#Backpack in Products > Price");
```

**The accumulated judgement** - ~40 rules in [CLAUDE.md](CLAUDE.md), each bought with
a real failed run: why a nested lookup into a modal finds nothing, why a `timeoutMsg`
must never be built eagerly, why driver-call count is the only cost figure that
travels from a laptop to a CI agent.

**The exploratory half** - a regression asserts what somebody already thought of.
Charters under `test/exploratory/` drive the app and run *oracles* over what they
find: duplicate ids, repeated copy, unlabelled controls, text nothing can address,
dead controls, clipped content. That is where new bugs actually come from.

**The guard rails** - a device lock, provenance stamping so a run says which tree it
describes, errorshots on every failure, and four decisions the AI is not allowed to
make on its own. See [docs/testing/agentic-workflow.md](docs/testing/agentic-workflow.md).

## Requirements

- Node 20+, macOS or Linux
- **Android**: Android SDK, an emulator image (API 30+), `ANDROID_HOME` set
- **iOS**: Xcode + Simulator (macOS only)
- **A built app** - an `.apk`, or a `.app` built for the Simulator

Confirm the tooling before the first run - both of these fail in ways that look
like framework faults later:

```bash
xcrun simctl list devices available    # iOS. If it errors, open Xcode once and
                                       # let it install its additional components.

export ANDROID_HOME=/path/to/android-sdk          # put these in ~/.zshrc, not
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"   # one shell
adb devices                            # empty is fine; "command not found" is not
emulator -list-avds                    # `npm run android:avd` creates the one this
                                       # framework is verified against
```

If your binaries are not in `apps/`, point at them with `IOS_APP_PATH` /
`ANDROID_APP_PATH` rather than renaming anything. See
[docs/guides/building-the-app.md](docs/guides/building-the-app.md).

⚠️ **You do not need React Native, Android Studio, Xcode projects or your app's
source.** This framework drives a *pre-built binary* and deliberately cannot build
one. If you can install the app on an emulator by hand, you have everything it needs.

Appium itself is a dev dependency and is started and stopped by the wdio service -
do not run `appium` yourself.

## Documentation

| | |
|---|---|
| [docs/README.md](docs/README.md) | the map |
| [CLAUDE.md](CLAUDE.md) | the rules, and what to read before changing what |
| [docs/guides/devices.md](docs/guides/devices.md) | booting a device, and the one that is pinned |
| [docs/architecture/page-objects.md](docs/architecture/page-objects.md) | THE ONE RULE, and why |
| [docs/architecture/waits.md](docs/architecture/waits.md) | how to wait for things |
| [docs/architecture/test-data.md](docs/architecture/test-data.md) | deterministic data, and secrets |
| [docs/testing/agentic-workflow.md](docs/testing/agentic-workflow.md) | the loop, the roster, the boundaries |
| [docs/history/experiments.md](docs/history/experiments.md) | what was tried and reverted |

## When not to use this

Honest limits, so nobody adopts it for the wrong job:

- **Not a unit-test replacement.** E2E is the slowest, most expensive layer. If a
  behaviour can be checked below the UI, check it there.
- **Not for apps with no accessibility tags.** The framework addresses elements by
  `testID` / `accessibilityLabel`. An untagged app needs the tags added first - which
  is itself a worthwhile outcome, but it is app work, not test work.
- **Not for cross-device visual regression.** No screenshot diffing here; errorshots
  are evidence, not assertions.
- **Not unattended.** The loop is fast, not autonomous. Findings are drafts and
  exclusions need a person.

## Licence

MIT. No third-party app binary is redistributed in this repository - `apps/*` is
gitignored on both branches, and the `demo` branch fetches its demo app from the
vendor's own GitHub release at setup time, pinned by tag and verified by SHA-256.
