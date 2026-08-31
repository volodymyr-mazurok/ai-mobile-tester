# Requirements

**The test basis** - what the app is supposed to do, written before and independently
of any test.

This directory is the input to the `automate-requirement` skill. Hand it one of these
files and it produces a plan: what to assert, what already covers it, what page-object
and fixture work it needs, and where the spec goes.

If what you have is *not* in this format yet - a TestRail or Jira export, a Confluence
page, a spreadsheet of manual cases - `import-cases` converts it into one of these
files first, keeping the source ids so a result can be reported back.

## Why they live here

A requirement written *after* the test is not a requirement, it is a description. It
can only ever agree with the code. Keeping the intent in its own file, in its own
language, is what makes it possible for a test to **disagree with the app** - which is
the only way a test finds anything.

⚠️ **When a test and a requirement disagree, that is a finding, not a bug in the
test.** Decide which is wrong deliberately. Rule 14: adapt the test if the test is at
fault; never soften an assertion to make broken behaviour look fine.

## Format

```
# REQ-<n>: <feature>

## Context      one paragraph - who uses this and why
## Requirements R<n>.<m>, each one testable and independently true or false
## Out of scope what this requirement deliberately does not cover
## Notes        anything a test author needs that is not a requirement
```

Keep each requirement **atomic** and **observable**. "The login screen is usable" is
not testable. "An empty username shows the message *Username is required*" is.

## Current

| | |
|---|---|
| [REQ-001-login.md](REQ-001-login.md) | authentication |
| [REQ-002-catalog.md](REQ-002-catalog.md) | product catalogue |
