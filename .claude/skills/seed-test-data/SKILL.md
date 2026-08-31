---
name: seed-test-data
description: Give a suite deterministic data it controls, by implementing or using a TestDataProvider. Use when a test needs data the app does not ship with, when an assertion keeps being loosened because shared data moved under it, and ALWAYS before touching anything that deletes data.
---

# Seed test data

**Read [docs/architecture/test-data.md](../../../docs/architecture/test-data.md) first.**
This skill is the procedure; that page is the contract and the reasoning.

## 0. Establish whether you need this at all

Plenty of good suites do not. Ask, in order:

1. **Does the app ship with fixed content?** A demo catalogue, a bundled dataset, a
   mock server the debug build points at. If so, assert against it and stop here.
2. **Is the assertion you want actually about the data?** "The cart badge increments"
   needs no seeding. "Total Assets is 2" does.
3. **Are you loosening an assertion because shared data moved?** That is the real
   signal you need a provider - the suite has stopped testing the app and started
   testing the environment.

If 1 or 2 answers it, say so and do not build a provider. An unnecessary provider is
a permanent cost: a second system to keep in step with the app's schema.

## 1. Find out what already exists

```bash
cat config/app.ts | grep -A2 testData      # is a provider already named?
ls test/support/                            # is one already implemented?
```

If a provider exists, extend it. Do not add a second mechanism - the predecessor
repo grew two parallel credential systems that way, and reconciling them cost more
than either was worth.

## 2. Implement the interface

`test/support/testData.ts` defines it. Three optional methods:

| method | when | must be |
|---|---|---|
| `setUp()` | once, before any spec, no device attached | loud on failure |
| `tearDown()` | once, after every spec, pass or fail | **idempotent**, and safe after a failed `setUp` |
| `afterEachTest()` | after every test | best-effort, never fails a test |

Point `config/app.ts` at it:

```ts
testData: { provider: "./test/support/myProvider" }
```

## 3. The rules that are not negotiable

⚠️ **Anything you mark for deletion carries the run's suffix.**
Two runs overlap more often than you think - a local run and a CI run against the
same shared environment. A cleanup that deletes "test users" deletes the other run's
fixture mid-test, and the failure reads as an application bug.

The guard belongs in **what a suite marks**, not in the shared cleanup. A cleanup
clever about what is safe to delete will one day be clever about the wrong row.

⚠️ **Drop the session before deleting the account it belongs to.**
An app holding a token for an account that no longer exists can come up blank on the
next launch and never reach any resting state - relaunching does not help, because
the token is persisted. `wdio.conf.ts`'s `onComplete` does device work first for
exactly this reason.

⚠️ **Never seed from inside a test.** `setUp()` runs in the main process with no
device. A test that seeds mid-run makes its own timing part of its assertion.

⚠️ **Secrets come from `.env`.** Never a committed file - see
[requireEnv.ts](../../../config/env/requireEnv.ts) for what that cost last time.

## 4. Destructive work is not yours to decide

Seeding is safe. **Deleting is not.** If your provider's `tearDown` will remove data
from a shared environment, say what it will delete and get a person to confirm
before the first run. See
[agentic-workflow.md](../../../docs/testing/agentic-workflow.md#what-the-ai-does-not-decide).

## 5. Verify before you rely on it

```bash
npm run typecheck
npm run wdio:android -- --spec test/specs/<one>.e2e.ts
```

Check three things: `setUp` ran once (not per spec), `tearDown` ran even though you
interrupted the run, and running twice in a row leaves no residue.
