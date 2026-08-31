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

> **You are on the `demo` branch** - the framework already wired to a real app, so it
> does something the moment you clone it. Switch to **`main`** for the boilerplate:
> the same framework with no app, no specs and no findings, ready to point at yours.

## Quick start

```bash
npm install          # postinstall applies patches/ - don't skip it
npm run setup        # fetch the demo app binary (32 MB, pinned + checksummed)
npm run android:boot # boot the emulator
npm run wdio:android # run the suite
```

That runs against **Sauce Labs' My Demo App RN**, bundled as a worked example so the
framework does something real out of the box.

To watch the exploratory half instead:

```bash
npm run explore:android
```

## Pointing it at your app - three files

| file | what it holds |
|---|---|
| `config/app.ts` | ids, binaries, auth strategy, test-data provider |
| `test/pageobjects/app.contract.ts` | how the framework asks *your* app "are you ready / signed out" |
| `test/pageobjects/screens.ts` | your screens, and how to reach each one |

Nothing else hardcodes an app id.

```ts
// config/app.ts
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
const price = await ActionHelper.getText("#Sauce Labs Backpack in Products > Price");
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

You do **not** need a built app on this branch - `npm run setup` fetches the demo
one. Pointing the framework at your own app needs an `.apk` or a Simulator `.app`
and nothing else: it drives a *pre-built binary* and deliberately cannot build one.
See [docs/guides/building-the-app.md](docs/guides/building-the-app.md).

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

MIT. The bundled demo app is a third-party binary fetched from its vendor's own
GitHub release at setup time and is **not** redistributed in this repository.
