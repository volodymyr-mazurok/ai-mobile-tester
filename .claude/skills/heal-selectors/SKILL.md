---
name: heal-selectors
description: Repair page objects after a new app build changes or removes testIDs - capture, diff, classify each change, and propose updates. Use after dropping in a new .app/.apk, or when several specs start failing with "element wasn't found" at once.
---

# Heal selectors after an app build

## ⚠️ The rule that makes this safe

**A missing element is a FINDING until proven a rename.** Healing means teaching the
tests where something moved. It must never mean teaching the tests to stop looking for
something the app has genuinely lost - that is the app regression this suite exists to
catch, and "fixing" it deletes the signal.

For every disappearance, answer *which*:

| | evidence |
|---|---|
| **renamed** | something new with the same role and shape appears in the same place |
| **removed** | nothing took its place - **the screenshot shows it is really gone** |
| **not laid out** | Android only; scroll to it and re-capture before concluding anything |
| **state-dependent** | a ticked checkbox has `checkedIcon`, an unticked one `box` - never both |
| **grouping-only** | a node that only wraps children and was never separately in the tree |

Only **renamed** is healed silently. **Removed** goes to
`docs/findings/APP_ISSUES.md` and the test stays red until someone decides.

## 1. Capture the app as it now is

Both platforms, every screen you intend to heal, including modals open and content
below the fold. Use `screen-mapper`, or `inspect-live-screen` by hand.

## 2. Diff

```bash
npm run capture:tree -- .explore/<charter>-ios
```

Three lists: undeclared ids, declared-but-absent, and the skeleton. **Read its output
rather than hand-diffing** - ids are composed from a prefix, so grepping for a full id
finds nothing in the repo and `capture:tree` is the only drift detector there is.

## 3. Classify every difference before changing anything

Work the table above, one element at a time. Two traps specific to this app:

- **A container can be absent from Android's tree while its own children are in it.**
  The fix is to declare the children FLAT, not to re-point the container. That exact
  confusion produced a bug report that had to be withdrawn - rule 13.
- **A modal's subtree only exists while the modal is presented.** "Absent" in a
  capture taken with it closed means nothing.

## 4. Propose, then verify

- Keep the comments, any shared components under `test/pageobjects/components/`, and
  every hand-written `{ ios, android }` XPath pair. The generator gives structure;
  **the curation is the valuable part.**
- `npx tsc --noEmit`, then run the affected specs on **both platforms**.
- ⚠️ **Never mass-rename.** A bulk edit that makes the suite green tells you nothing
  about whether it still tests anything. Heal one screen, run its spec, repeat.

## 5. Record it

- New or renamed ids that make automation harder → `docs/findings/TESTID_IMPROVEMENTS.md`.
- Anything genuinely removed or broken → `docs/findings/APP_ISSUES.md`, after a manual
  repro and a duplicate check.
- If the app's structure changed enough to invalidate them, update
  `docs/reference/app-quirks.md` - it is the memory that stops the next person
  rediscovering the same oddity.
