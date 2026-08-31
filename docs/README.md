# Documentation

Start at the [repo README](../README.md) if you just want to run the suite.

## Getting set up

| | |
|---|---|
| [guides/building-the-app.md](guides/building-the-app.md) | producing the `.app` / `.apk` this framework drives, and where to put it |
| [guides/devices.md](guides/devices.md) | Simulator and emulator - the one verified AVD, booting by hand, device localisation |

## How the framework works

| | |
|---|---|
| [architecture/page-objects.md](architecture/page-objects.md) | `Component`, THE ONE RULE, the four selector builders, the `ActionHelper` path grammar |
| [architecture/waits.md](architecture/waits.md) | why there is no `browser.pause()` in a spec, and what replaced each one |
| [architecture/performance.md](architecture/performance.md) | driver round-trips, the `[cost]` line, the per-test ceilings, the one retry |
| [architecture/authentication.md](architecture/authentication.md) | the three auth strategies, why webview values are pasted, the session lifecycle, suite isolation |
| [architecture/test-data.md](architecture/test-data.md) | the `TestDataProvider` seam, and where secrets come from |

## Testing

| | |
|---|---|
| [testing/suites.md](testing/suites.md) | spec order, the fixture's contract, test order, the exclusion policy |
| [testing/exploratory.md](testing/exploratory.md) | charters - the half a regression suite cannot do |
| [testing/agentic-workflow.md](testing/agentic-workflow.md) | the skills and agents, what each is for, and what the AI does not decide |
| [reference/app-quirks.md](reference/app-quirks.md) | per-screen accessibility-tree oddities, captured live |
| [reference/xpath.md](reference/xpath.md) | XPath cheat sheet for both platforms |

## CI

| | |
|---|---|
| [guides/ci.md](guides/ci.md) | what a CI job has to provide - the device, the scale factor, the artifacts - and what was measured the hard way |

## Findings

The actual deliverable. `npm run explore:index -- search "<words>"` ranks a candidate
finding against all of it before you write anything new.

| | |
|---|---|
| [findings/APP_ISSUES.md](findings/APP_ISSUES.md) | open findings about the app |
| [findings/TESTID_IMPROVEMENTS.md](findings/TESTID_IMPROVEMENTS.md) | testability asks, with app-source file and line |
| [findings/BUG_REPORTS.md](findings/BUG_REPORTS.md) | the tracker-ready restatements |
| [findings/COVERAGE.md](findings/COVERAGE.md) | per-screen inventory: what each suite checks, and what it does NOT |
| [findings/EXPLORATORY_SESSIONS.md](findings/EXPLORATORY_SESSIONS.md) | what has been explored, including sessions that found nothing |

⚠️ These five filenames are `SCREAMING_SNAKE_CASE` on purpose, unlike the rest of
`docs/`. They are referenced as identifiers - by `scripts/findings-index.mjs`, by the
skills and agents under `.claude/`, and by the comment a spec carries beside every
`[EXCLUDED <id>]`. Renaming one is a bigger change than it looks.

All five ship EMPTY, as format specs for you to fill in. `node
scripts/findings-index.mjs` reads them, so keep the shape.

## History

[history/](history/) - approaches tried and reverted, and diagnoses that turned out
wrong. Not current guidance; kept because several of the reverted approaches look
like obvious improvements, and rediscovering why they are not is expensive.
