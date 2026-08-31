---
name: import-cases
description: Turn test cases or requirements that live in someone else's format - a TestRail or Zephyr export, a Jira epic, a Confluence page, a spreadsheet of manual cases, a Word doc, a plain-text list - into this repo's `requirements/REQ-*.md` test basis, with source ids preserved. Use BEFORE automate-requirement, whenever the input is not already a REQ file.
---

# Import test cases

Input: test cases or requirements in a foreign format.
Output: one or more `requirements/REQ-<n>-<slug>.md` files in this repo's format, each
requirement traceable back to the id it came from.

This skill does **not** decide what is worth automating and does not write a spec.
That is `automate-requirement`, then `create-test`. This one only gets the test basis
into the repo without losing or inventing anything.

```
import-cases → automate-requirement → create-page-object → create-test → run-regression
```

## 0. Establish that you need this at all

If the input is already a `requirements/REQ-*.md` file, stop - go straight to
`automate-requirement`. If someone hands you a single acceptance criterion in chat,
that is also not an import; `automate-requirement` takes it directly.

Use this skill when the input is **a body of cases in another shape** and the repo has
nowhere to put them.

## 1. Read the source before converting a line of it

Get the whole thing in front of you first. A partial read produces a partial test
basis that looks complete, which is worse than an obviously empty one.

| source | how it usually arrives |
|---|---|
| TestRail / Zephyr / Xray | CSV or XML export - one row per case, steps in one cell |
| Jira | an epic with child issues, or a CSV export; acceptance criteria in a custom field |
| Confluence | an HTML or Word export, or a pasted page |
| a spreadsheet | CSV; often one sheet per feature |
| a Word/Google doc | prose with numbered steps |
| a chat message | a list someone typed out |

Record, for the report: how many cases came in, what fields each had, and which
fields you could not map.

⚠️ **Do not fetch from Jira, Confluence or TestRail yourself unless the user has
already connected that integration and asked you to.** Ask for an export. The
credentials question is theirs, not yours.

## 2. A manual case is a procedure. A requirement is a claim.

This is the whole job, and it is not mechanical.

A manual test case says *what to do*. A requirement says *what must be true*. Converting
one to the other means finding the claim the procedure was checking, and it usually is
not written down anywhere.

**Before**, a TestRail case:

```
C-1042  Login with locked account
Steps:  1. Open the app
        2. Tap the hamburger menu top-left
        3. Tap "Log In"
        4. Type alice@example.com in the first field
        5. Type 10203040 in the second field
        6. Tap the blue "Login" button
Expected: An error appears
```

**After**, a requirement:

```
**R1.6 — Locked-out account.** (C-1042)
Submitting valid credentials for a locked account does not sign in, and shows an
error that says the account is locked. It must be distinguishable from a wrong
password — a customer who has been locked needs to know to contact support rather
than retry.
```

What changed, and why each one matters:

- **Navigation became a precondition, not a requirement.** Steps 1-3 are how you reach
  the screen. They belong to R1.1, once, not to every case that starts there.
- **"the blue button top-left" is gone.** A requirement that names a colour or a
  position is a description of the current build. It can only ever agree with the app.
  Describe the control by what it does.
- **"An error appears" became a specific, falsifiable claim.** "An error appears" is
  satisfied by the wrong error. That is exactly how a test goes green over a real
  defect - rule 13, and the lesson this repo was built on.
- **The distinguishability clause was added** because it is the reason the case exists
  at all - and it came from asking, not from guessing. See §4.

For every case, write down **what would prove it false**. A case with no failure mode
is a description; say so and leave it out.

## 3. Number, split and merge

Ids are `R<n>.<m>` where `<n>` is the REQ file. They are how a spec, a finding and a
coverage line refer to the same thing, so:

- **One REQ file per feature**, not per source document. Five TestRail sections about
  login are one `REQ-00n-login.md`.
- **Split a case that checks several independent things.** "Login validates empty
  username and empty password" is R1.3 and R1.4. A test that can fail for two unrelated
  reasons cannot tell you which.
- **Merge cases that restate one claim** at different levels of detail - exports are
  full of these. Record every source id on the surviving requirement.
- **Never renumber on a later import.** Append. An id in a spec comment or an
  `APP_ISSUES.md` entry must keep pointing at the same claim.

Check the existing basis before you add anything:

```bash
ls requirements/
npm run explore:index -- search "<the claim in your own words>"
```

## 4. What you do not know, you write down as a question

⚠️ **Never invent a requirement to fill a hole in the source.** An imported case that
says only "Expected: works correctly" does not become a requirement by you deciding
what correct means. That is the app's behaviour being promoted to a specification, and
it makes every test written from it unable to disagree with the build.

Three outcomes, and all three are legitimate:

| the source says | what you write |
|---|---|
| a specific, falsifiable expectation | a requirement |
| a vague expectation you can make specific **from other cases or the source doc** | a requirement, with the inference noted in *Notes* |
| a vague expectation and nothing to resolve it | an entry under **Open questions**, not a requirement |

Open questions go in the REQ file itself, under their own heading, with the source id.
They are a deliverable - they are the list the product owner has to answer, and
producing it is often worth more than the import.

⚠️ **Do not resolve an ambiguity by opening the app and looking.** That is the same
mistake as §2's "an error appears": it writes the build into the spec. Capture the
screen when you need to know whether a test is *possible* (`inspect-live-screen`),
never to decide what is *correct*.

## 5. Write the files

Exactly the format in [requirements/README.md](../../../requirements/README.md):

```markdown
# REQ-<n>: <feature>

## Context

One paragraph — who uses this and why. Include test accounts and data in a table if
the source named any.

## Requirements

**R<n>.1 — <short name>.** (<source ids>)
<one testable, observable claim>

## Out of scope

- <what the source deliberately excluded, and anything you dropped in §3, with why>

## Open questions

- **<source id>** — <what the source did not say, and who has to answer it>

## Notes

- <anything a test author needs that is not a requirement — the drawer showing both
  Log In and Log Out regardless of state, that kind of thing>

## Source

Imported from <system> <export name/date> by `import-cases` on <date>.
<n> cases in → <m> requirements + <k> open questions. Unmapped: <fields>.
```

Then add the file to the **Current** table in `requirements/README.md`.

⚠️ **Keep the source ids.** They are how somebody checks your import against the
original, and how a result gets reported back into the system the cases came from. An
import that loses them cannot be audited and has to be redone by hand.

## 6. Verify the import before you hand it on

- **Count.** Every source case is accounted for: became a requirement, merged into one
  (say which), became an open question, or was deliberately dropped (say why). No
  silent losses.
- **Re-read for procedures that survived.** Grep your own output for `tap`, `click`,
  `button`, `top-left`, `blue`, `then`, `navigate to`. Each hit is probably a step that
  should have been a precondition or a claim.
- **Re-read for unfalsifiable claims.** `works`, `correctly`, `properly`, `as
  expected`, `is displayed`, `is usable`, `successfully`. Each hit is either an open
  question or needs the specific observable outcome.
- **No colours, coordinates or element ids** anywhere in a requirement.

```bash
grep -nEi '\b(tap|click|blue|top-left|works correctly|as expected|successfully)\b' requirements/REQ-<n>-*.md
```

## 7. Report back like this

```
Source:     <system>, <export>, <n> cases
Written:    requirements/REQ-<n>-<slug>.md — <m> requirements (R<n>.1–R<n>.<m>)
Merged:     C-1042 + C-1043 → R1.6            (same claim, different detail)
Split:      C-1051 → R1.3, R1.4               (two independent failure modes)
Dropped:    C-1077                            (no failure mode — pure navigation)
Open questions: <k> — listed in the file, need <who> to answer
Unmapped fields: <priority, owner, …>
Next:       automate-requirement on REQ-<n>, which decides what is worth a test
```

⚠️ **The import is not coverage.** A REQ file in the repo proves nothing runs. Do not
update `docs/findings/COVERAGE.md` here - that happens when a test exists and passes.
