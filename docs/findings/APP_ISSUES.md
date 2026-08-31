# App issues

Defects **in the app**, found by this framework and reproduced by hand. Not test
bugs, not framework artefacts, not known gaps.

> ⚠️ **This file is the deliverable.** A wrong entry costs more than a missed one:
> somebody will act on it, and the credibility of every other entry goes with it.
> Rule 13 - reproduce by hand before writing here, and rule out the four framework
> artefacts first (see [../testing/exploratory.md](../testing/exploratory.md)).
>
> ⚠️ **Claude drafts entries; a person files them.** See
> [../testing/agentic-workflow.md](../testing/agentic-workflow.md#what-the-ai-does-not-decide).

**Ids.** `A1`, `A2`, ... in the order they were found. Never renumber - the id is
how a test exclusion, a bug report and an exploratory session refer to the same
thing. Suffix a variant `A4a`.

**Format.** Keep the heading line machine-readable: `### A<n>. <one-line summary>`.
`npm run explore:index -- search "<words>"` reads it.

---

### A1. Logout confirmation repeats a word: "Are you sure you sure you want to logout?"

- **Platform** Android (demo app v1.3.0, build 244)
- **Screen** navigation drawer → Log Out
- **Found by** manual capture during framework bring-up
- **Reproduce** open the drawer, tap Log Out, read the dialog body.
- **Expected** "Are you sure you want to logout?"
- **Actual** "Are you sure you **sure you** want to logout?"
- **Evidence** `errorShots/*-R1_7_*.png`; native `AlertDialog`, `android:id/message`.
- **Severity** cosmetic - user-visible copy defect on a confirmation the user must
  read to act on.
- **Covered by** `test/specs/login.e2e.ts` → *R1.7*, currently **red on purpose**
  (rule 14). It asserts `repeatedPhrase(message) === null` and receives `"you sure"`.
- **Status** open. Not excluded - a person decides that, not the AI.

> ⚠️ **The first version of that test passed.** It compared each word with the next
> one, which catches `"the the"` and completely misses `"you sure you sure"` - no two
> *adjacent* words there are equal. Green, against a build that visibly had the bug.
> The oracle now checks repeated **phrases** (`utils/copy.ts`), and the same check
> runs over every text node in the exploratory sweep.

*Kept as the worked example of a real, verified, third-party finding. Delete it when
you point this framework at your own app.*
