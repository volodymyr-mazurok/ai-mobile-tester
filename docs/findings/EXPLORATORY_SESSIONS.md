# Exploratory sessions

One entry per charter run: what was explored, what turned up, and what happened to
it. The log exists so a later session can tell "nobody has looked at this" from
"somebody looked and found nothing".

**Format.**

```
## <date> - <charter> (<platform>)
**Charter** one line: what this session set out to probe.
**Evidence** .explore/<dir>
**Observations** <n> raw, <n> after triage
**Outcome** what became a finding, a gap, or nothing - with ids.
```

⚠️ **"Nothing found" is a result and belongs here.** An unlogged session is one
somebody else will repeat.

---

## 2026-08-29 - sweep (android)

**Charter** visit every top-level screen, run the oracles over each, probe two
controls no spec taps.
**Evidence** `.explore/sweep-android/`
**Observations** 16 raw, 16 after triage (all one family)
**Outcome** all 16 are the same testability issue - product cells share one id per
field across every row. Filed as testability ask **#1**, not as an app bug: the app
behaves correctly, it is just unaddressable. No app defects found by this charter.

*Note: the first run of this charter reported 275 observations, 271 of them
`untagged-text`. Those were a framework artefact - the harness read only
`resource-id` as an id, and this app tags with `accessibilityLabel`
(`content-desc`). Fixed in `test/support/explore.ts`; a reminder that rule 13's
"rule out the framework first" applies to the exploratory harness too.*
