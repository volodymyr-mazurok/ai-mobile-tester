# Devices

WDIO **attaches** to a device, it does not start one. Without a booted
Simulator/Emulator a run fails at session creation with an empty `adb devices`,
which reads like a driver problem and is really "there is no device".

Every `wdio:android*` script therefore boots the emulator first. The boot is
idempotent, so chaining it costs ~0.2s when one is already running.

```bash
npm run android:boot     # start + wait for a full boot (no-op if already up)
npm run android:kill
npm run android:status   # SDK path, AVD, attached devices, boot state
npm run android:avd      # create the ONE verified AVD; RECREATE=true rebuilds
npm run ios:boot         # simulator equivalent; IOS_DEVICE_NAME or the default
```

## ONE Android device, or "it passed locally" means nothing

There is one definition, **`config/androidDevice.json`**, and everything else
derives from it:

- **`npm run android:avd`** creates exactly it - installs the system image, applies
  the same framebuffer override CI applies. Idempotent.
- **`scripts/android-emulator.mjs` defaults to that AVD name**, so
  `npm run wdio:android` uses the verified device rather than a leftover.
- **`wdio.conf.ts` fingerprints the attached device** on every Android run and
  prints `[device] android API 35 / x86_64 / 720x1600 @240dpi = 480x1066 dp`,
  warning loudly when any of it differs. Advisory, never fatal - a mismatched device
  still gives a usable run, and the point is that you can *see* the mismatch in two
  lines instead of assuming parity.
- **A CI job that restates these numbers** - because its config language cannot read
  a JSON file - has to be kept in step by hand. ⚠️ Change one, change the other; the
  fingerprint is what catches you if you don't. See [ci.md](ci.md).

Measured on a real project, local against CI:

| | local (`MobileQA_API35`) | CI (`MobileQA_API35`) |
|---|---|---|
| API level | 35 ✅ | 35 |
| image tag | google_apis ✅ | google_apis |
| device profile | pixel_7 ✅ | pixel_7 |
| ABI | arm64-v8a | x86_64 (necessary - see below) |
| screen | 1080x2400 @420 = **411x914 dp** | 720x1600 @240 = **480x1066 dp** |

**The ABI is the one field that deliberately differs.** An emulator must run the
host's architecture or it translates every guest instruction, so Apple Silicon gets
arm64-v8a where CI's Intel agents get x86_64. Everything that changes what a test
*sees* is identical.

**The geometry difference does not explain what it gets blamed for.** CI had MORE
logical room than local (480x1066 dp against 411x914), so more fits above the fold
there, not less. The failures blamed on it were an **Android-versus-iOS** problem,
not a local-versus-CI one: Android's page source contains only what is LAID OUT, so
a test that scrolls to a section's title and then reads its lower children fails on
any Android device. They passed locally because local runs were on iOS, where
XCUITest keeps off-screen scroll content in the tree.

**The real local-versus-CI variable is LATENCY**, and it is enormous: a round-trip
to the driver costs ~50ms on a dev machine and ~3s on a hosted agent. See
[../architecture/performance.md](../architecture/performance.md).

### CI runs API 35, and that is not a preference

API 30 was tried for a day to shed system weight and cost two separate failures: its
bundled WebView **crashed** on a hosted sign-in page (`SIGSEGV`, null deref in
`libmonochrome.so`, at the moment of submit - not memory pressure, there was no
`lowmemorykiller` activity), and its accessibility mapping differs from the one the
page objects had been written against.

Both are the same underlying mistake: a CI signal is only worth having if a red run
means the app is broken rather than the image being different. Weight was never the
problem anyway - API 35 boots in 90s, the same as API 30, now that the guest is
accelerated.

## Booting by hand

```bash
# iOS Simulator - "iPhone 16e" / iOS 26.3 matches wdio.conf.ts's defaults
xcrun simctl boot "iPhone 16e"

# Android - CREATE IT FIRST, and use THIS AVD, not a hand-rolled `emulator -avd <whatever>`
npm run android:avd
npm run android:boot
```

By hand, if you need to:

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
emulator -avd MobileQA_API35 -no-snapshot -no-boot-anim

# ...then WAIT for it. `adb devices` reports the device long before Android is
# usable; poll the boot flag instead:
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 5; done
```

**The emulator must OUTLIVE the shell that starts it.** Backgrounding it with a
plain `&` inside a script or tool call is not enough - when that shell exits it
takes the emulator with it, and the only symptom you get later is WDIO's
`✖ Failed to create a session` with an empty `adb devices`. Start it in its own
terminal, or detach it properly (`nohup ... & disown`).

## Ask the tool, don't inspect the directory

An earlier version of the table above was wrong, and wrong in an instructive way: it
claimed local was API 37 / `google_apis_playstore` / 426x952 dp and that the
project's AVD "does not exist on this machine". All of that came from listing
`~/.android/avd/*.avd` in one shell and reading the only name that came back - an
unrelated AVD. **`emulator -list-avds` listed four**, including the project's. Two
CI runs each paid 35 minutes for the same lesson.

## One device, one session

`maxInstances` in `wdio.conf.ts` is deliberately `1`. A real Simulator/Emulator can
only be driven by one Appium session at a time; raising it lets spec files run
concurrently against the same physical device and race each other. Confirmed live -
it produced a spurious login failure that looked like a selector bug and wasn't.
**Don't raise it.**

### And `maxInstances` only governs ONE process - the lock governs the rest

`maxInstances: 1` stops spec files racing inside a single wdio run. It says nothing
about two *processes*: two terminals, two Claude sessions, an agent starting a run
while a regression is going. Those interleave exactly the same way, with exactly the
same symptom - taps landing on the other session's screen, failing as if a selector
were wrong.

**`scripts/device-lock.mjs` arbitrates that**, and every npm script that opens an
Appium session goes through it (`wdio:*`, `explore:*`). Booting a device is not a
session, so `android:boot` / `ios:boot` are deliberately unwrapped.

```bash
npm run device:status     # free, or who holds it since when
npm run device:release    # force-release a lock you know is wrong
```

- **Refused, not queued, by default.** A busy device fails at second zero naming the
  holder, rather than mid-run. Add `--wait <seconds>` to queue instead - that is what
  an agent should do.
- **A dead holder is retired instantly** via `kill -0` on the recorded PID, not after
  a timeout. (One CI run waited 35 minutes on a device whose emulator had died two
  seconds in; the lesson is to check that what you are waiting for still exists.)
- **It also watches port 4723.** Something listening while nothing holds the lock
  means an un-locked run, Appium Inspector, or a leftover server. That is a warning,
  never a refusal - a stray server with no session attached is harmless, and refusing
  on it would make the lock worse than the problem.
- **`DEVICE_LOCK=off`** bypasses it entirely, loudly. **CI is an automatic no-op** -
  one agent, one device, no contention, and no new failure mode in the pipeline.

⚠️ **It cannot change what a test sees.** No driver call, no selector, no timeout, no
fixture. The only thing it can do wrong is refuse a run that should have started -
which is why every refusal names the holder and prints the two ways out.

## ⚠️ Anything OUTSIDE the app is localised to the DEVICE

Your app ships English strings, so it is easy to forget the OS around it might not.
Measured live: a Simulator set to **Ukrainian** brought up the document picker
reading "Недавні" / "Спільне" / "Огляд" / "Пошук" - so a helper written against
"Recents" / "Browse" / "Search" reported "the picker never appeared" while a
screenshot showed it plainly open.

**Never match a system-UI string.** Anything that drives an OS surface - a document
picker, a share sheet, a permission dialog - has to address it by something that
cannot be translated:

| | |
|---|---|
| iOS | element TYPES (`XCUIElementTypeSearchField`, `XCUIElementTypeCell`) and, where there is no type to aim at, position by INDEX |
| Android | the system app's RESOURCE IDS, matched on the `:id/...` suffix (`dir_list`, `roots_list`, `search_src_text`) so they hold across provider packages (`com.android.documentsui` vs `com.google.android.documentsui`) |
| both | a value that is YOURS - a filename carrying the run's suffix, say - typed into a field found by type |

Prefer SEARCH over walking a location: it needs no knowledge of where the surface
opened, and the query is yours.

Appium's `appium:language` / `appium:locale` would make such a surface *predictable*
rather than merely label-proof, by relaunching in a chosen language. Deliberately
NOT set here: it changes the locale for every suite in the run, which is a large
side effect for a problem the rules above already solve.

## Other device facts

- **Debug and release bundle ids often differ**, and assuming the release one for a
  debug build silently targets an app that is not installed. Verify with `xcrun
  simctl listapps` / `adb shell pm list packages` and put what you find in
  `config/app.ts`, which is the only place it belongs.
- **Cold start on a fresh install is slow** (20-30s+, worse on the Android
  emulator). That is why `appContract.waitForAppReady()`'s ceiling is 60s.
- **Which backend a build talks to is an app-build decision, not a framework one.**
  This framework drives whatever binary you hand it; it cannot and should not
  re-point one at a different environment.
- **Android's `getPageSource()` only returns what is currently laid out.**
  Off-screen content in a scroll view isn't in the tree at all. iOS's XCUITest tree
  can include some off-screen scrollable content, but not reliably enough to depend
  on - scroll on both platforms for consistency.
