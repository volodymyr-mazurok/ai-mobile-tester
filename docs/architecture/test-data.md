# Test data

> **The short version.** A suite that asserts *"the list holds exactly these 3 rows"*
> is worth far more than one that asserts *"whatever the shared account holds this
> week"*. Getting there means the run controls its own data. **How** you control it is
> yours; this page is the seam the framework offers and the rules that keep it safe.

## The seam

[`test/support/testData.ts`](../../test/support/testData.ts) defines one interface:

```ts
export interface TestDataProvider {
  setUp?(): Promise<void>;        // once, before any spec
  tearDown?(): Promise<void>;     // once, after every spec - pass or fail
  afterEachTest?(): Promise<void>;// after every test - best effort
}
```

`config/app.ts` names the module that implements it:

```ts
testData: { provider: "none" }                      // the default
testData: { provider: "./test/support/myProvider" } // yours
```

The default is `NoTestData` - the suite asserts against whatever the app ships with.
That is correct for a demo app, and it is the honest default: a provider that
pretends to seed and doesn't is worse than none.

### Why an interface and not an implementation

The repo this framework was extracted from carried **24,419 lines** of one company's
database layer - a service class per table, per business object. All of it real, none
of it reusable anywhere else. Deleting it is most of what made this a boilerplate.

What generalises is the *lifecycle*, not the queries. So the framework says **when**
it will call you, and nothing about how you answer.

Your implementation might be SQL, a REST admin API, a GraphQL mutation, a fixture
file, or a debug menu inside the app itself. All are fine.

## Where secrets come from

**`.env`, and nowhere else.** `config/env/requireEnv.ts` reads them; `.env.example`
documents the names.

⚠️ **This rule is not decorative.** The predecessor repo hardcoded four identity
provider client secrets and a database password in committed TypeScript. They were
moved to `.env` later - but git keeps history, so all five had to be rotated and the
repo could not be shared until it was re-created without its history.

A CI checkout makes it worse: most CI systems clone in full by default, so every
historical value of a hardcoded secret lands on the agent's disk.

## The rules that survive any provider

**Anything a suite marks for deletion must carry the run's suffix.**
Two runs may overlap - a developer's local run and a CI run against the same shared
environment. A cleanup that deletes "test clients" deletes the other run's fixture
mid-test, and the failure looks like an application bug.

The guard belongs in **what a suite marks**, not in the shared cleanup. A cleanup
that tries to be clever about what is safe to delete is a cleanup that will one day
be clever about the wrong row.

**`tearDown()` must be safe to call twice, and safe after a failed `setUp()`.**
A ctrl-C'd run, a crashed worker and a `setUp` that threw halfway all reach it with
the world in an unknown state. Residue on a shared environment is the thing it
exists to prevent.

**Order matters when you delete an account the app is signed into.**
Drop the session *before* deleting the identity. An app still holding a token whose
account no longer exists can render a blank screen on next launch and never reach
any resting state - and relaunching does not help, because the token is persisted.
`wdio.conf.ts`'s `onComplete` does the device work first for exactly this reason,
and `reinstallApp()` in `test/support/session.ts` is the recovery when it happens
anyway.

**Never seed from within a test.** `setUp()` runs in the main process with no device
attached, which is the right place for database and API work. A test that seeds
mid-run makes its own timing part of the assertion.

## When you do not need a provider at all

Plenty of good suites don't. If the app ships with fixed content - a demo catalogue,
a bundled dataset, a mock server the app points at in debug builds - assert against
that and keep `provider: "none"`.

The tell that you *do* need one: an assertion you keep loosening because the shared
data moved under it. That is the point at which the suite has stopped testing the
app and started testing the environment.
