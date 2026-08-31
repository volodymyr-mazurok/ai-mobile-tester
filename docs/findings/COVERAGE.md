# Coverage

What the suite checks, and - more usefully - **what it does not**.

> The "Does not cover" lists are the point of this file. They are the difference
> between "the suite is green" and "the app works", and they are what an exploratory
> charter is aimed at. `npm run explore:index -- gaps` reads them.
>
> ⚠️ **A known gap is not a finding.** Before writing anything into `APP_ISSUES.md`,
> check here: if the behaviour was never covered, that is a gap to close with a test,
> not a bug to report.

**Format is load-bearing** - `scripts/findings-index.mjs` parses it:

```
## <Screen> - <n> tests
### Covers
- ...
### Does not cover
- ...
```

---

*(none yet — one section per screen, added as suites are written. `cover-gap`
and `automate-requirement` both read this file to avoid duplicating what exists.)*
