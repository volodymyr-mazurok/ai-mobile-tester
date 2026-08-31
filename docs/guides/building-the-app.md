# Getting the app binary

This framework **drives pre-built binaries**. It does not build your app, and it
should not - a test repo that can build the app is a test repo that can disagree with
what shipped.

## What it needs

| platform | artefact | where it goes |
|---|---|---|
| Android | `.apk` (debug or release-with-debuggable) | `apps/`, path in `config/app.ts` |
| iOS | `.app` **built for the Simulator** (not a device `.ipa`) | `apps/`, path in `config/app.ts` |

⚠️ **A device `.ipa` will not run on a Simulator.** Different architecture, different
signing. If your CI publishes only an `.ipa`, you need a second Simulator build.

## Getting it onto the machine

The simplest thing that works: drop the file in `apps/` by hand and point
`config/app.ts` at it. That is enough to run.

Better, once more than one person runs this: write a fetcher and wire it to
`npm run setup`, so a new machine needs one command. Pull from wherever your builds
already live - an Azure Artifacts feed, an App Center release, an S3 object, a CI
artifact URL.

The `demo` branch has a working example of exactly that
(`scripts/fetch-demo-app.mjs`): it downloads from the vendor's own GitHub release,
**pinned by tag and verified by SHA-256**, and is safe to run twice. Copy its shape.

⚠️ **Pin the version and verify a digest.** A moving "latest" means a green run and a
red run can describe different apps, which is the one thing a regression suite may
never allow.

⚠️ **Do not commit binaries.** `apps/*` is gitignored. An APK is tens of megabytes
and changes every release; committing them makes every clone pay for every version
ever built.

## Getting the ids right

Both the bundle id / package name and (on Android) the launchable activity go in
`config/app.ts`. Read them off the binary rather than guessing:

```bash
# Android
$ANDROID_HOME/build-tools/*/aapt2 dump badging apps/App.apk \
  | grep -E "^package|launchable-activity"

# iOS
/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" apps/App.app/Info.plist
```

⚠️ **Debug and release builds usually have different ids** (`com.example.app.dev` vs
`com.example.app`). Using the release id against an installed debug build targets an
app that is not there, and the failure reads as "could not resolve the launchable
activity" rather than "wrong id".

## Checking it before you write any test

```bash
npm run android:boot
adb install -r apps/App.apk
adb shell am start -n <package>/<activity>
adb shell dumpsys activity activities | grep ResumedActivity
```

If that does not put your app in the foreground, no amount of Appium configuration
will. Sort it out here first - it takes a minute and saves an afternoon.
