# Exploratory testing

**A regression suite is structurally incapable of finding anything nobody thought
to assert.** It checks what somebody already knew to check, which is the right shape
for a signal and the wrong shape for discovery. `COVERAGE.md`'s "Does not cover"
lists are that blind spot written down.

A **charter** under `test/exploratory/` is the other half. It drives the app and
RECORDS what it sees, and it deliberately **does not assert** - a red charter means
the charter broke, and a green one tells you nothing. Its output is evidence, which
is then triaged into a finding, a test, or nothing.

```bash
CHARTER=./test/exploratory/sweep.charter.ts npm run explore:ios     # or :android
npm run explore:index -- search "en space currency"                 # is it known?
```

## The pieces

**`wdio.explore.conf.ts`** runs them. It spreads `wdio.conf.ts` rather than
standing alone, so it keeps the real `onPrepare`/`onComplete` and a charter gets
the same seeded fixture every suite gets, torn down afterwards. Charters can never
join a regression run - `orderedSpecs()` only reads `test/specs/`.

⚠️ **A charter run therefore pays for the whole fixture**, seeded before it and
deleted after it, however long your `TestDataProvider` takes. Run one session with
the charters you mean to run, rather than one charter at a time in a loop.
`specFileRetries` is 0 here: a retry re-drives the app through whatever the first
attempt already changed.

**`test/support/explore.ts`** is the harness - `startSession`, `step` (which
swallows what it throws, because half a session's evidence beats a stack trace),
`snapshot`, `delta`, `inventory`, and two things worth knowing about:

- **`smells()`** - every oracle the tree alone can answer, run over a snapshot at no
  extra round-trip cost: leaked `undefined`/`NaN`, copy that repeats a phrase
  back-to-back, one testID matching two elements, visible text with no addressable
  owner, unlabelled controls, currency and dash inconsistency, zero-size content,
  horizontal clipping.
- **`probe()`** - do something, diff the tree, and flag `dead-control` when
  **nothing moved**. That is the signature of the two most expensive findings the
  predecessor project ever filed - a confirmation message that was never shown, and a
  Save button that did nothing on one emulator. Both were found by a person noticing
  that nothing happened; `probe()` makes it a recorded fact instead.

It parses the page source **independently of `utils/pageSource.ts`**. That one is
deliberately narrow (id and text) because it is a hot path; exploration wants
geometry, element type and ancestry, and widening a load-bearing read for a
diagnostic's sake is the wrong trade.

⚠️ **`ownerId` is NOT the parent** - it is the node's own id when it has one, and
only falls back to the nearest tagged ancestor for an untagged node. That is what the
text and geometry oracles need. **For ancestry use `parentId`**, and compare against
the whole chain rather than one hop, since a tagged node in between is still nesting.
Both fields carry a note in `explore.ts`; confusing them produced one confidently
wrong answer about an app's nesting.

### Standing instruments are worth building

`main` ships one charter, `sweep.charter.ts`, which walks `SCREENS` and runs the
oracles over every screen. Most charters answer a question once and are then only
history - but two kinds earn a permanent place, and are worth writing for your app:

- **A NESTING charter**, answering *"does this tagged container actually CONTAIN its
  tagged children?"* ⚠️ `npm run capture:tree` **cannot** answer that: it diffs which
  testIDs are PRESENT against what the page objects declare, and says nothing about
  the tree's shape. THE ONE RULE depends on the shape, so this is the only instrument
  that can tell you a build changed composition. Run it on **both** platforms, and
  include a container you already know nests as a built-in control - an all-FLAT
  result then means the capture or the analysis is wrong rather than the app.
- **A PERSISTENCE charter** - something that CHANGES a setting and re-reads it after
  a relaunch. No smoke suite does this, and it is where "the app forgot" lives.

**`scripts/findings-index.mjs`** (`npm run explore:index`) indexes every known
finding, every `COVERAGE.md` gap and every `it()` title, and ranks them against a
query.

⚠️ **Exploration's failure mode is not missing things - it is re-reporting things
already written down**, and burying the one new finding in a list the app team has
already decided about. ⚠️ **A miss is not proof of novelty**: it matches words, and
two people describe one defect differently.

**[../findings/EXPLORATORY_SESSIONS.md](../findings/EXPLORATORY_SESSIONS.md)**
records what has been explored, per area, **including sessions that found nothing** -
without those rows, an area nobody has looked at is indistinguishable from one that
came back clean. It also holds the ranked charter backlog.

## Triage is not optional

**One withdrawn finding is why.** It was written into `APP_ISSUES.md` and a test was
excluded for it, on two runs of evidence. One manual attempt on the device retired
the whole entry - the cause was a selector reading Android's laid-out-only page
source, not the app.

- Reproduce by hand before filing.
- Scope a finding to the platforms actually observed.
- Rule out the four framework artefacts that produce more false findings here than
  everything else combined:
  1. Android's laid-out-only page source
  2. a nested lookup into a modal
  3. `visible="false"` on rendered nodes
  4. `autoAcceptAlerts` eating a native alert

## Skills and subagents

- **`explore-app`** - run a charter-based session and triage what turns up.
- **`cover-gap`** - turn a finding or a `COVERAGE.md` gap into a spec / page-object
  change that doesn't duplicate what already runs.

Two subagents go with them: **`exploratory-tester`** runs one charter end to end in
its own context (a session produces thousands of tree nodes; only the conclusions
should reach the conversation), and **`finding-triage`** decides whether a candidate
is new, a duplicate, a coverage gap or a framework artefact, read-only.
