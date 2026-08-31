# Pace: what a test costs

**A test's cost is its ROUND-TRIP COUNT, and iOS pays far more per call in CI.**

> Every measurement on this page comes from the predecessor project this framework
> was extracted from - a real React Native app, nine suites, a hosted CI pipeline.
> The *mechanisms* are all in this repo and all still true; the *numbers* are there
> to show the size of the effect, not to describe anything `main` runs today.
The requirement is that a run produces the same results at roughly the same pace
locally and in CI. What breaks that is never the assertions - it is how many
driver round-trips a test makes, multiplied by what a round-trip costs on the
machine it runs on.

`wdio.conf.ts`'s `afterTest` prints `[cost] N driver calls | <test title>` for
every test. **That number is the one cost figure that means the same thing on both
machines**, because the count is a property of the test while per-call latency
differs ~60x (~50ms on a dev machine, ~3s on a hosted agent). Rank by the count,
and treat **four figures as a bug**.

It deliberately does **not** project a duration. Measured across one CI run, the
implied constant was 0.5s per call for a small test and 2.7s for a large-list one, so any
single multiplier would be a guess wearing a number's clothes. It also counts the
test BODY only - `beforeTest` runs after Mocha's `beforeEach`, so a suite that
navigates and scrolls in `beforeEach` isn't paying for it in these figures.

## Android is already at local pace. iOS in CI is not

One suite, 17 tests, 29,595 driver calls, same commit and same fixture throughout:

| | wall clock |
|---|---|
| local iOS | 10m 43s ✅ |
| CI **Android** | **5.3 min** ✅ |
| CI **iOS** | **>2 hours, killed** ✗ |

XCUITest re-snapshots the entire element hierarchy for every query, so a call
costs with the size of the tree rather than with what was asked for - and on a
hosted agent, sharing 4 cores with a Simulator that has no GPU, that snapshot is
orders of magnitude more expensive than on a dev Mac. Nothing about the app, the
fixture or the assertions differs. Only the constant does.

## Three patterns produced every four-figure count

All three are fixed at the source, and all three are easy to write again.

**1. `#text in <collection>`** - the worst by far. `Component.resolveOne`'s
`byText` branch walked the members one at a time: a `getText()` on each, then a
`$$` for its descendants plus a `getText()` on each of THOSE when it didn't match.
Over a 98-row grid that was **8,117 calls for one test**, 4,578 for
another, 2,192 for a third. It now asks the page source which member holds the
text (one call) and addresses that member by its own exact id (one more).

A miss has to be **authoritative**, which the first version got wrong: it answered
only for TAGGED text and fell back to the walk otherwise, so it made hits cheap
and hits were already the cheap case. **A waiting loop is nothing but misses** -
one test spent **84,865 driver calls** polling for a row to appear, then failed. `parseSource` now walks the tags with
a stack and attributes EVERY text-bearing node, tagged or not, to its nearest
id-bearing ancestor, so "the members are here and none shows this" is a fact
thrown immediately. Only a source with NO members still falls back, which on
Android means the container isn't laid out and the source genuinely cannot answer.
Measured after: **426 calls on Android, 410 on iOS**.

**2. A `getText()` per member** to read a collection. Use
**`ActionHelper.getTexts(path)`** / **`getIds(path)`** / **`getCount(path)`**,
which answer from one page source when the selector knows its id shape (`rowField`
and `byRecordId` both record one). ~396 calls became 1 for that grid.

**3. An eager `timeoutMsg`.** A `timeoutMsg` is a plain string, so an `await`
inside it runs while the options object is constructed, *before* the wait: it
costs an extra read every time, it reports the state from before the wait rather
than after it, and if that read throws (on Android, whenever the element is not
laid out) the test fails from inside the construction of its own error message.
Read into a variable inside the predicate and build the message in a `catch`.
Grep for `await` on the same line as `timeoutMsg`.

## Cost is calls × tree size, not calls alone

One CI run's three failing grid tests were only **868 driver calls between them**
and took **2194 seconds** - far above even that run's average of ~0.70s per call.
All three ran while the grid was EXPANDED to 98 rows. A call against a big tree is
not the same unit as a call against a small one.

Two consequences:

- **A ceiling must catch a hang, not punish a heavy suite.** Those tests are slow,
  not stuck. Failing them at the ordinary 540s ceiling was strictly worse than
  letting them run: the spec then failed, which triggered a full spec-file retry,
  which is where most of that run's remaining budget went. `longFlowTimeout()`
  exists for exactly this case.
- **When a test is expensive, ask what the tree looked like at the time.** Not
  expanding a 98-row grid at all, where the assertion allows it, is worth more
  than shaving round-trips off the work done while it is open.

## A SCOPED `$$` is a different price from a root one

**Read the Appium log, not just `[cost]`.** Grouping one CI run's `appium.log` by
endpoint:

| endpoint | what it is | calls | s/call | total |
|---|---|---|---|---|
| `POST /element/<id>/elements` | **`$$` scoped to an element** | 66 | **56.37** | **62.0 min** |
| `POST /elements` | `$$` from the root | 134 | 0.66 | 1.5 min |
| `POST /element` | `$` from the root | 392 | 1.87 | 12.2 min |
| `POST /source` | the whole page source | 59 | 5.78 | 5.7 min |

**Sixty-two minutes in ONE selector** - a 98-row collection - out of a 234-minute
run. Two more of the same shape sat behind it at 121.34s and 97.67s for a SINGLE
call each. XCUITest re-snapshots the
*subtree* for an element-scoped search, so the price scales with whatever it is
scoped to; asking the same question at the root, or asking for the source, is one
snapshot however it is phrased.

**`[cost]` cannot see this, by design** - a scoped `$$` is ONE driver call. That
is the metric's blind spot, and this is what lives in it. The tests concerned
looked cheap: 195 and 165 calls, and 15 minutes each.

Two things to generalise:

- When a collection's selector is a full exact id or a `byRecordId` prefix it is
  globally unique, so scoping the search to a parent buys nothing and can cost two
  orders of magnitude. THE ONE RULE is about *correct addressing*; it is not a
  reason to pay for a subtree snapshot when the id already identifies the element.
- **Before making a polled call faster, check what the loop around it was actually
  waiting for.** A wait whose single iteration exceeds its own timeout is not a
  wait, it is a fixed sleep wearing a wait's clothes - and speeding up the call
  converts it into the timeout it always should have been. That is exactly what
  happened when `getCount` moved onto the page-source fast path; see
  [history/experiments.md](../history/experiments.md).

## Per-call cost, not just call count

iOS had no tuning at all while Android already had `disableWindowAnimation` and
`enforceXPath1`. iOS now sets:

- `appium:waitForIdleTimeout: 2000` - bound the wait for quiescence rather than
  remove it. `waitForQuiescence: false` is the bigger speed-up and the real
  flakiness risk, so it is deliberately not set.
- `appium:reduceMotion: true` - the Simulator equivalent of Android's animation
  switch.
- `appium:disableAutomaticScreenshots: true` - XCTest's per-step captures, which
  nothing here reads; failure screenshots come from our own `afterTest`.

All three are verified against `appium-xcuitest-driver` 10.26.0's `desired-caps.js`
rather than assumed. Their magnitude is only measurable in CI.

## One failure must not cost the whole suite

`afterTest` relaunches the app after any failed test, once its screenshot is
safely taken. Measured: one test hit the 900s Mocha ceiling with a list expanded,
and the next three failed reading a screen nobody had put back (`expected "Show
All (98)", got "Show less"`, `"Folders" has 0`, `'Show All' did not expand the
grid`). None of those three was a real defect.

A Mocha timeout is the worst case: Mocha abandons the test but the driver commands
it left in flight keep running, so a spec's own `beforeEach` races them and cannot
fix this from inside.

## The per-test ceilings

**`suiteTimeout()` / `longFlowTimeout()` in `test/support/timeouts.ts` - 540s and
900s on iOS.** Halved from 900s/1800s: with `TIMEOUT_SCALE=3` on iOS, the old heavy
tier was **thirty minutes for a single `it`**. Nothing waits that long
deliberately; what a ceiling that size buys is a hung test burning a quarter of an
hour before anyone finds out.

Sized from measurement - the worst legitimate CI test recorded was 335.6s, *before*
the round-trip work above - so the ordinary tier keeps a 1.6x margin. **Cut it
again from a real run's JUnit results, never from a local run**, and never from one
run (rule 12).

`longFlowTimeout()` is reserved for suites that genuinely wait on a third party: a
first login, a password change that waits on a confirmation email, a connectivity
drop, a hook that pays for the run's fixture.

**`TIMEOUT_SCALE` is one knob for "this device is slower than a dev machine".**
Every timeout in a spec or page object is a dev-machine number and each was
measured against a real failure, so **scale, don't rewrite**: hard-coding CI-sized
numbers would throw that reasoning away and make a local run take minutes to fail.
Unset (the default, i.e. local) is 1, so a dev run is bit-for-bit unchanged.

## `specFileRetries: 1` - for a wedged WebDriverAgent, not a flaky test

Appium reuses ONE WebDriverAgent across every spec file, and it degrades. Measured
in a full local iOS regression: one spec, as the EIGHTH consecutive spec file,
failed three times over (the test, its `beforeEach`, the suite's `afterAll`) on
`Could not proxy command to the remote server ... timeout of 240000ms exceeded ...
element/…/click`, costing 26 minutes of a 57-minute run - and passed **8/8 in
1m 38s on its own**, same commit, same simulator. Another had the same shape at the
fourth spec.

It is not a quiescence wait: `waitForIdleTimeout: 2000` was already in force, so
the settle wait was bounded at two seconds. WDA had simply stopped answering, and
because `maxInstances: 1` makes one session equal one spec file, a spec-file retry
*is* "run this against a fresh session".

It softens no assertion - a real failure fails both attempts and still reports -
and it is **not deferred**, because deferring would retry an authenticated spec
after the sign-out specs and break the spec ORDER that lets a run pay one sign-in.

**If a retry starts rescuing the same spec every run, that spec has a bug.** Go and
find it rather than let the retry hide it.

### `appium:useNewWDA: true` is the better fix, and it is local-only

Measured, same commit and same simulator: one spec **as the 7th spec file** lost
BOTH attempts (the retry dying EARLIER than the first attempt, test 2 against test
6) and **as the 2nd spec file passed 7/7 in 4m29s**. Turning `useNewWDA` on took
that iOS run from 2 failed specs to 1.

It is **gated to local**, a deliberate local-versus-CI divergence: `useNewWDA`
uninstalls and relaunches WDA per session, which is seconds on a dev Mac and ~300s
on a hosted agent, so eight of them would add ~40 minutes to a 4-5 hour job. **The
CI half is therefore unverified by construction** - measure per-session WDA cost
before ever enabling it there.

The gate is an inline `TF_BUILD || CI` check rather than `ciExclusions.inCI()`,
because that helper is deliberately falsified by `RUN_CI_EXCLUDED=true` and would
switch this on for exactly the pipeline run that asked for the excluded tests.

## A hosted iOS agent may not be a stable signal, and exclusion cannot fix it

Three consecutive full iOS CI runs of the same suite, on three commits, produced
three largely DISJOINT failure sets:

| run | heaviest spec, attempt 1 | failures | total |
|---|---|---|---|
| 1 | 62 min | 3 - one real, + 2 **retry artefacts** | 3h54m |
| 2 | **35 min** | 4 - 3 collection waits, + 1 artefact | 4h39m |
| 3 | 84 min | **6, across three different specs** | 4h47m |

**Not one of run 3's six failures appeared in runs 1 or 2.** So there was no fixed
set of bad tests to exclude: excluding a run's failures would have deleted real
coverage and the next run would have failed a different set. Rule 16 -
`itExceptInCI` is for a test that fails *reproducibly* on a hosted agent and passes
on a real one. It is **not** a tool for run-to-run variance, and using it that way
buys a green pipeline that has stopped measuring anything.

Two things follow, and both generalise:

- **The same spec's first attempt ranged 35 → 84 minutes for identical work.** Rule
  12: never size a ceiling, or claim a speed-up, from one run. Rank by driver calls,
  and confirm a cost change in the Appium log by endpoint rather than by wall clock.
- **The durable fix was a machine, not a test change.** The same suite on the same
  commit was ~33 minutes and green on a dev Mac against 4-5 hours and flaky on a
  hosted one. Every remaining iOS problem measured was per-call latency against a
  Simulator sharing four cores with no GPU; no test-side change removes that.
  **Android was the control**: on a hosted Linux agent with KVM, 103 tests, 0
  failures, 67 minutes - already at local pace. See
  [../guides/ci.md](../guides/ci.md).
