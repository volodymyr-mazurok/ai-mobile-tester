# The suites

`wdio.conf.ts` builds the run by **reading `test/specs/`** and taking every
`*.e2e.ts`, so a new spec joins automatically and only prose like this can go
stale. `main` ships none; the `demo` branch has two worked examples.

**[../findings/COVERAGE.md](../findings/COVERAGE.md) is the per-screen inventory:
what each suite checks, what it does NOT, and what to expand next.** Re-derive it
from `test/specs/` rather than trusting it - `node scripts/findings-index.mjs tests`
lists every test title the repo actually has. The findings themselves live in
[../findings/APP_ISSUES.md](../findings/APP_ISSUES.md).

## Pre-auth suites run LAST

A suite that signs the app OUT has to run after the ones that need it signed in,
because the signed-in session survives the relaunch `afterSuite` does between spec
files - so every authenticated suite shares one sign-in, and signing in is the
flakiest thing any mobile suite does.

`config/wdio/specOrder.ts`'s `PRE_AUTH_SPECS` is the list; put your sign-in,
registration or password-reset spec basenames in it. `ensureSignedOut()` in
`test/support/session.ts` is how such a suite gets to the signed-out state, using
whatever `app.contract.ts` says signing out means for your app.

⚠️ **A suite that changes a credential has to write the new one back into the
fixture**, or every later suite has stale credentials. That is a reason to own the
credential in your `TestDataProvider` rather than in a spec.

## The fixture

The framework does not seed anything. It calls a `TestDataProvider` you supply -
`setUp()` once before any spec, `tearDown()` once after every spec, `afterEachTest()`
between tests - and the default (`NoTestData`) asserts against whatever the app
ships with. See [../architecture/test-data.md](../architecture/test-data.md).

Four things about a fixture that are easy to get wrong, each of which cost a real
run in the predecessor project:

- **Rule 17: anything a suite marks for deletion must carry the run's suffix.**
  The guard belongs in *what a suite marks*, not in the shared cleanup - a cleanup
  that tries to be clever about what is safe to delete is one bug away from deleting
  a shared account.
- **Tear down in `tearDown()`, not after every test.** `afterEachTest()` is for
  per-test records a spec created itself. Anything the whole run shares must not be
  deleted out from under the tests that follow.
- **`tearDown()` must be safe to call twice, and safe after a half-finished
  `setUp()`.** A cancelled run reaches it with the world in an unknown state, and
  residue on a shared environment is the thing it exists to prevent.
- **Raise the suite timeout** (`this.timeout(suiteTimeout())`) and **reset scroll
  and any overlays in `beforeEach`**. Scroll position persists between tests, and a
  sheet or modal left open by a failing test hides the chrome and cascades into every
  test after it.

Read the `seed-test-data` skill before touching anything that deletes data.

### Rule 15: assert containment and relationships, not fixture sizes

Adding to a fixture can break a suite that never mentions it. A real case: seeding
four documents also generated a notification each, so a client's notification list
went from one row to four and six unrelated tests failed on `expect(1)`. Nothing was
wrong with the app or with the seeding - the suite had been written against a
fixture size.

Rewritten, it asserted that the one notification it cared about was *present*, that
the unread-dot count equalled the row count, and that Read and Unread *partition*
the list. All three survive a fixture that grows.

### Some states a good fixture cannot reach

An empty state is the usual one: a fixture that seeds data into every category is,
by doing its job, incapable of rendering "there is nothing here". Two honest
options, and the wrong one is quietly asserting nothing:

- **Assert the empty-state id is ABSENT while data is present.** That catches the
  regression that would actually bite - a populated screen claiming to be empty -
  and leaves the empty state's own text unverified. Say so in a comment.
- **Seed a second, deliberately empty fixture.** Real work, not an oversight: it
  needs its own setup, its own teardown, and a place in the spec ORDER that does not
  cost the run a second sign-in. Record it as a gap in `COVERAGE.md` until it is done.

## Test order, and non-idempotent suites

Order matters inside a suite whose write tests change what its read tests count.
Put the writes last, and have each one put back what it changed - through the app's
own flow where possible, so the undo is itself covered.

### Rule 10: read the FIRST attempt's failure

Some things cannot be put back. Opening an item may clear its "new" badge
permanently, with no app action that restores one. A spec-file retry then re-runs
the read tests in a world its own previous attempt already changed, and reports
failures that do not exist.

A worked example from the predecessor project, one suite, one run:

| attempt | failures |
|---|---|
| 1st | one - a genuine upload failure |
| 2nd | three - the upload, plus two counts its own first attempt had changed |

Two of the three failures in that run's report were manufactured, and the retry
cost 66 minutes to produce them. **Nothing was wrong with the app, the fixture or
the assertion.**

`config/wdio/artifacts.ts` now writes a retry to `.attempt2.xml` and leaves attempt
1 alone, so both are readable - but the decision to exclude a test must never be
taken from a second attempt's evidence. If a suite looks flaky, suspect the retry
before the tests: run it alone, with retries off, on a clean device.

## Exclusion policy

**A known-broken test is EXCLUDED, not left red.** A regression run has to be
readable at a glance, and it cannot be if it always ends in failures you are
expected to know are "the normal ones". Anything that fails every run for an app
reason no test-side change can fix, or that fails *intermittently*, is marked
`it.skip` with an `[EXCLUDED <issue>]` title prefix and a comment naming the
`APP_ISSUES` entry. It still appears in the report, as pending rather than failed,
so it cannot be quietly forgotten.

**Rule 14: adapt the test if the test is at fault; never soften an assertion to
make broken behaviour look fine.** Exclusion is the last step, once adaptation has
been tried and cannot work - and the finding always stays in `APP_ISSUES.md`, which
is the actual deliverable.

`grep '\[EXCLUDED' test/specs/` lists what is currently excluded, and
`node scripts/findings-index.mjs tests` counts it.

### `itExceptInCI` - excluded from the PIPELINE only

`test/support/ciExclusions.ts`; title prefix `[CI-EXCLUDED <id>]`. It is for the
narrow case of a test that genuinely passes on a real device and cannot be made to
pass on a hosted agent - **not** for anything the app gets wrong. Each entry needs a
line in `CI_EXCLUSIONS` naming *what is different about CI*; the skip logs itself
loudly on every run, and `RUN_CI_EXCLUDED=true` runs them anyway so an entry can be
retired.

**It hides a local-versus-CI divergence by construction.** A green pipeline whose
green depends on not running things is worth less than a red one that tells the
truth. So it is the THIRD thing to try, after fixing the test and after fixing its
cost: five tests that looked like "CI is just too slow" turned out to be 396-to-8,117
round-trip loops, and every one was a fixable test. Rule 16 - **keep the list at one
or two entries**; if it grows, something systemic is being papered over.

**Scope every entry to a platform** (`platform: "ios" | "android"`; omit to exclude
on both). Excluding on both when the evidence covers one throws away a working
platform's coverage to describe a problem it does not have.

### The standard of evidence

What makes an exclusion safe is evidence that **the test is not at fault**. Two
patterns worth copying:

- **An errorshot plus the test's own dump.** One entry was justified by a screenshot
  showing the form complete - filled, valid, submit enabled, no keyboard up - beside
  a tree dump showing that 240 seconds later the app still had not navigated. 240s is
  not a timing squeeze.
- **A near-miss worth remembering.** A different test failed only in CI for five
  builds and was nearly excluded for it. The cause was `adb` missing from the run
  step's PATH - a one-line environment bug. Excluding it would have buried the fault
  permanently. **Read the actual error every time**, and treat "fails only in CI" as a
  question rather than an answer.

### Suspect the page source before blaming the app

**Before excluding anything because "the app doesn't render it on Android", suspect
`getPageSource()` first.** Android reports only what is currently LAID OUT. In one
day that single mechanism was behind **four** separate failures that each read like
an app bug: a tile count that saw 0 of 83, a list that lost its lookup after
scrolling to the bottom, a folder listing that read `[]` for its whole 120s budget,
and a finding filed as "a newly created item is never shown" that was nothing of
the sort.

The fix has the same shape every time: read the thing as a **row-spanning
collection** with `.catch(() => [])`, or walk and union what each screenful reports,
instead of a single `#text in <collection>` lookup that throws when its container is
not in the tree.

**That last one is the cautionary tale, and it cost a wrong bug report.** Two runs of
evidence were read as an intermittent app race, written into `APP_ISSUES.md` and
excluded. **One manual attempt on the device retired the whole entry** - the item
appeared immediately when a person created it. Rule 13: drive the flow by hand before
filing. It takes minutes, and a wrong entry in `APP_ISSUES.md` is worse than no
entry, because the file is the deliverable.

## Divergences from a spec are DOCUMENTED, not asserted

Where a build knowingly differs from its design spec in small ways - a button label,
a placeholder, a missing back link - the test asserts **what the build actually
does**, with the divergence named in a comment. That keeps the suite a regression
signal instead of a wall of permanent red that everyone learns to ignore. Only a
genuine functional gap gets a red test or an `APP_ISSUES` entry.

Leave those comments in place even after a divergence is reviewed and accepted:
they are the reason an assertion reads the way it does, and without them the next
person "fixes" the assertion back to the spec.
