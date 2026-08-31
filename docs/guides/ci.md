# Running this framework in CI

This boilerplate ships **no pipeline**. A mobile suite's CI job is mostly agent
plumbing - which pool, which image, how binaries arrive - and that is your
organisation's shape, not the framework's. What the framework does have is a set of
requirements a job has to meet, each bought with a failure in the predecessor
project. Meet them in GitHub Actions, GitLab CI, Jenkins or anything else.

## What a job must provide

**1. A booted device before `wdio` starts.** WDIO *attaches*; it does not boot. With
nothing attached the run dies at session creation with an empty `adb devices`, which
reads like a driver fault and is really "there is no device". Locally the
`wdio:android*` scripts chain `android:boot`; a job has to do the equivalent.

⚠️ **The emulator must outlive the shell that starts it.** Most CI systems run each
script step in its own shell, and a plain `&` background job dies with it. Use
`nohup … & disown`, or a step that blocks until boot completes.

**2. The one pinned Android device.** [`config/androidDevice.json`](../../config/androidDevice.json)
is the single definition; `npm run android:avd` creates exactly it, and
`wdio.conf.ts` fingerprints the attached device on every Android run and warns when
it differs. **If your CI restates those numbers** (because its config language cannot
read JSON), keep the two in step - the fingerprint line is what catches you when you
forget. See [devices.md](devices.md).

**3. An ABI matching the host, and only the ABI.** An emulator must run the host's
architecture or it interprets every guest instruction: `arm64-v8a` on Apple silicon,
`x86_64` on Intel/AMD agents. Both `scripts/android-emulator.mjs` and the AVD
creation derive it from `uname -m`, so this needs nothing from you except an APK
that matches - a mismatch surfaces as `INSTALL_FAILED_NO_MATCHING_ABIS`. Everything
else that changes what a test *sees* - API level, image tag, screen geometry - is
pinned and must not drift.

**4. `TIMEOUT_SCALE`.** Every timeout in the framework is a measured number times
this factor (see [../architecture/performance.md](../architecture/performance.md)).
A round-trip to the driver costs ~50ms on a dev machine and seconds on a shared
hosted agent, so a job that does not scale is a job that fails on latency and reports
it as a selector bug. Scale; do not rewrite the individual numbers. Rule 7.

**5. Artifact collection, unconditionally.** Publish these whether the run passed or
failed - a step that only runs on success collects nothing from the runs you care
about:

| path | what it is |
|---|---|
| `test-results/*.xml` | JUnit, one file per spec runner. Merge them into one run per platform |
| `errorShots/` | a screenshot per failed test and failed hook. Rule 11: read these before re-diagnosing from an error message |
| `logs/appium-<platform>.log` | the only record of per-endpoint cost, and the only thing that says which *phase* of session creation was slow |

The platform is in every filename and deliberately not in the directory names, so
two runs on one machine cannot silently overwrite each other's evidence - see
`config/wdio/artifacts.ts`. Publish the directories wholesale; renaming one breaks
that contract, renaming files inside it does not.

**6. One Appium session per device, and one run per agent.** `maxInstances` is `1`
and stays `1` (rule 4). That governs one wdio process; it says nothing about two
*processes*. On a hosted agent each run gets its own VM, so there is no contention
and `scripts/device-lock.mjs` no-ops automatically when `CI` is set. **On a
self-hosted machine the pin becomes real**: one agent, never two runs at once, or
they drive the same physical UI and fail as if a selector were wrong.

**7. `npm ci`, with `postinstall` intact.** It is what installs the Appium drivers -
Appium 3 resolves `appium-xcuitest-driver` / `appium-uiautomator2-driver` out of
`node_modules`, so there is no `appium driver install` step and nothing depends on
the agent user's `~/.appium`. It also runs `patch-package`, which is **not optional**
(see CLAUDE.md's Patches section).

**8. Secrets from the environment, never from the workspace.** `.env` is for local
runs; in CI supply the same names from the job's secret store. An env var already
set wins over `.env`, so a CI agent needs no `.env` at all.
[`config/env/requireEnv.ts`](../../config/env/requireEnv.ts) fails loudly on a
missing one rather than connecting with `undefined`. **Check out shallow**
(`fetchDepth: 1` or equivalent): a default full clone puts every historical version
of every secret on the agent's disk.

**9. A cancellation grace period.** The seeded fixture is torn down in `onComplete`.
A job cancelled mid-run orphans it in whatever environment it was seeded into, so
give cancellation a few minutes to finish rather than hard-killing.

**10. Manual or scheduled triggers, not a PR gate.** A mobile suite is
minutes-to-hours against a single serialised device. As a required check it blocks
every merge behind the device queue.

## Things measured the hard way

Carried from the predecessor project, because each cost real time to learn:

- **Hardware acceleration dominates core count.** A 2-core *accelerated* Linux agent
  beat a 4-core one emulating in software - emulator ready in 90s against 310s. Hosted
  Linux images often do have `/dev/kvm` but do not let the agent user open it, which
  looks exactly like "no acceleration on this pool" if you stop at the symptom. The
  fix is `sudo -n chmod 666 /dev/kvm` in the job, **not** `usermod -aG kvm` - group
  membership needs a new login session that is never going to happen, so it reports
  success and changes nothing.
- **The emulator clamps a guest to 1 vCPU below a 6-core host.** Everything after
  `-qemu -smp N` is passed to QEMU after that clamp, and the later value wins. Give the
  guest `NCPU - 1`; the host still has to run Appium, node and adb. Read `guest vCPUs:`
  in the boot log before believing any override took.
- **Do not cache the AVD directory.** `userdata-qemu.img` lives inside it, so the
  cache carries the previously installed app *and its signed-in session*. Restoring one
  put the app in a state holding a token for an identity that had since been deleted:
  a white screen it could not recover from through two reinstalls. It saved ~69s and
  cost a 13-minute run.
- **Do not cache WebDriverAgent's derived data.** A clean cache hit restored 221 MB in
  190s and `xcodebuild` recompiled everything anyway, because CI cache archivers do not
  preserve mtimes the way Xcode's incremental build needs. It validated perfectly
  locally with `tar`, which does. *A local stand-in that differs from the real
  mechanism in exactly the dimension under test proves nothing.*
- **Every `adb` call needs a bound.** `adb` has no timeout flag and macOS ships no
  `timeout(1)`; `|| true` catches a non-zero exit but not a process that never exits.
  One `am start -W` sat for 108 minutes - that flag waits for a launch to complete, and
  when the activity is already running there is no launch to complete. The job was then
  cancelled, which skipped the artifact publishers, so there was nothing to diagnose it
  from. Bound the call and set a step timeout: a hang should **fail** the step.
- **Never size a ceiling or claim a speed-up from one run.** Rule 12. The same suite on
  the same commit ranged 35 to 84 minutes on hosted agents. Rank by driver calls
  (`[cost] N driver calls`), and confirm a cost change in the Appium log by endpoint.
- **Excluded tests reporting as "not executed" is correct**, not a fault. Known-broken
  behaviour is `it.skip` with an `[EXCLUDED <id>]` title so a run reads at a glance -
  see [../testing/suites.md](../testing/suites.md#exclusion-policy).
