# Exploratory charters

A charter is a **session, not a test**. It drives the app somewhere the specs in
`test/specs/` do not go, records what it sees, and asserts nothing.
Read `test/support/explore.ts`'s header for why that separation matters, and
run one through the `explore-app` skill rather than by hand.

```bash
CHARTER=./test/exploratory/sweep.charter.ts npm run explore:ios
CHARTER=./test/exploratory/sweep.charter.ts npm run explore:android
```

Evidence lands in `.explore/<charter>-<platform>/` (gitignored): `notes.md`, a
`observations.json` for triage, plus a page source, screenshot and id inventory
per snapshot. A re-run **overwrites** its own directory.

## Writing one

- Name it `<charter>.charter.ts`. `sweep.charter.ts` is the worked example.
- One `it(...)` per charter, `this.timeout(longFlowTimeout())`.
- Wrap every step in `session.step(...)` - a charter must survive its own
  misses, because half a session's evidence beats a stack trace.
- Never `expect`. If you find yourself wanting one, the finding is ready to
  become a real spec: use the `cover-gap` skill.
- Reuse `signInForExploration()` (`test/pageobjects/screens.ts`) and the page
  objects. A charter that hand-rolls selectors is only ever testing its own
  selectors.
- A charter is **disposable**. Keep the ones worth re-running each release
  (`sweep`); delete the one-off ones once their findings are written up.

## Charters are logged

Add the session to `EXPLORATORY_SESSIONS.md` when you finish, including the ones
that found nothing - "this area was explored on this build and was clean" is the
result that stops the next session repeating it.
