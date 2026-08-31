---
name: run-regression
description: Run the regression suite on iOS and/or Android, stamp what tree it describes, triage anything red, and publish a report. Use when asked to run the regression, run the suite, run all the tests, or check whether the app or the framework still works.
---

# Run a regression

## 1. Decide the scope

```bash
npm run wdio:ios                 # every spec in test/specs/, in specOrder's order
npm run wdio:android             # boots the emulator first
SPEC_FILTER=checkout      npm run wdio:ios     # one spec
SPEC_FILTER=not:checkout  npm run wdio:ios     # everything else, order preserved
SPEC_FILTER=login,catalog npm run wdio:ios     # a list
```

- **Both platforms unless told otherwise.** They fail differently, and a result from
  one is not evidence about the other.
- **Two separate runs, never one.** Running both platforms inside a single CI job
  serialises two full suites into one time envelope that may not hold them.
- `ISOLATED=true` reinstalls the app per spec file. Reach for it when a run has left
  the app in a state you don't trust - not by default; it costs a reinstall *and* a
  sign-in per spec.

## 2. Before you start

```bash
npm run device:status      # free? every wdio:* script takes the lock
npm run config:diff        # did a refactor change the resolved config?
```

**Stamp what the run describes.** A regression takes 30-90 minutes; if the tree
changes underneath it, its results describe code that no longer exists. That has
happened - a fully green run against a tree that had been edited an hour before the
run finished, and it took an mtime comparison to notice.

```bash
{ echo "commit: $(git rev-parse --short HEAD)"
  echo "source-hash: $(find test utils config wdio.conf.ts -name '*.ts' -type f | sort | xargs shasum | shasum | cut -d' ' -f1)"
  echo "dirty: $(git status --porcelain | wc -l | tr -d ' ') files"
} | tee logs/provenance-<platform>.txt
```

Re-compute `source-hash` **after** the run. If it changed, say so in the report -
the results are still real, they just describe the earlier tree.

## 3. Run it, and keep the stdout

```bash
npm run wdio:ios > logs/run-ios-full.log 2>&1
```

⚠️ **Redirect to a file.** A spec-file retry **overwrites its own first attempt's
XML**, so stdout is the only place attempt 1's failure survives - and for `documents`
attempt 1 is the only attempt worth reading, because a retry is non-idempotent.

Run it in the background and check in periodically rather than blocking.

## 4. Read the result

```bash
for f in test-results/results-<platform>-*.xml; do
  echo "$f $(grep -o '<testsuites[^>]*>' "$f" | head -1)"
done
```

⚠️ **KNOW THE EXPECTED COUNT BEFORE YOU RUN, and record it per spec file** - a
mismatch then says WHICH spec moved rather than only that the total did. **An
unexpected count is itself a finding**: a spec that silently did not run reads as
success in every summary.

`node scripts/findings-index.mjs tests` is the baseline - it lists every `it()` title
in `test/specs/` with its state (running / excluded / ci-excluded), read from the
source rather than from a run. Compare the XML against that, not against a number
written in a document; a number in a document is wrong the moment somebody adds a
test, and a stale one makes every correct run look like a finding.

Expect the two platforms to differ where a spec is `[EXCLUDED]` or `itExceptInCI` on
one only. That is legitimate; anything else is not.

Count straight off the XML rather than by adding up the reporter's
`N passing` lines - those exclude skips, and on a retry they are printed twice:

```bash
python3 - <<'PY'
import glob,xml.etree.ElementTree as ET
T=F=S=0
for f in sorted(glob.glob('test-results/results-<platform>-*.xml')):
    if not open(f).read(1): print(f"{f}: EMPTY"); continue
    for ts in ET.parse(f).getroot().iter('testsuite'):
        T+=int(ts.get('tests') or 0); S+=int(ts.get('skipped') or 0)
        F+=int(ts.get('failures') or 0)+int(ts.get('errors') or 0)
print(f"tests={T} failures={F} skipped={S} passing={T-F-S}")
PY
```

⚠️ A `.attempt2.xml` in that glob is a RETRY - count the plain-named file for the
truth about attempt 1, and read the retry only to confirm it is the known
non-idempotent `documents` artefact.

Also collect the `[cost] N driver calls` lines. **Four figures is a bug**, and the
ranking is the one cost figure that carries from a dev machine to CI.

## 5. Triage everything red - one `failure-triage` agent per failure

They run in parallel and need no device. Give each one the test title, the spec, the
platform and the artifact paths. Then:

- **Never re-run to see if it goes green.** That converts a real failure into a flake
  you have stopped tracking.
- **Never read a retry's evidence** as if it were the failure.
- **Never exclude anything as part of a run.** Exclusion is a separate, deliberate
  decision with its own policy - see
  [docs/testing/suites.md](../../../docs/testing/suites.md#exclusion-policy).
- An `app-defect` verdict is a **proposal**. It needs a manual repro and a duplicate
  check before it goes anywhere near `docs/findings/`.

## 6. Report

Publish an artifact - the run is read by a person who should not have to open the
repo. Include:

- **provenance**: commit, whether the tree was clean, whether it changed mid-run;
- **counts per platform** against the expected table, and durations;
- **every failure**, with its triage verdict and the one-line cause;
- **cost outliers** - anything four-figure, and anything that moved a lot;
- **what was NOT run** and why (a spec filter, an excluded suite, a platform skipped).

⚠️ **Report the result faithfully.** If it is red, the report says red. A green
number produced by re-running until it passed is worse than a red one, because
somebody will trust it.
