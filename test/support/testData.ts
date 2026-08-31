/**
 * Where deterministic test data comes from - the seam that used to be 24,000
 * lines of one company's database layer.
 *
 * WHY THIS IS AN INTERFACE AND NOT AN IMPLEMENTATION. A suite that asserts
 * "Total Assets is 2" instead of "whatever the shared account holds this week"
 * is worth a great deal, and it needs data the run controls. But HOW you get
 * that data - SQL, REST, a GraphQL mutation, a fixture file, an app-level debug
 * menu - is entirely yours. The framework only needs to know WHEN to call you.
 *
 * The default is `NoTestData`: the suite asserts against whatever the app
 * ships with. That is correct for a demo app, and it is the honest default -
 * better than a provider that pretends to seed and doesn't.
 *
 * TO PLUG IN A REAL ONE
 *   1. implement TestDataProvider somewhere under test/support/
 *   2. point config/app.ts's `testData.provider` at its module path
 *   3. rule 17 still applies: anything you mark for deletion carries the run's
 *      suffix, and the guard lives in what a suite MARKS, not in the cleanup.
 */
export interface TestDataProvider {
  /**
   * Once, before any spec runs. Seed the data the whole run shares.
   * Throwing here fails the run before a single test gives a misleading result.
   */
  setUp?(): Promise<void>;

  /**
   * Once, after every spec has finished - pass or fail. Delete what setUp made.
   *
   * ⚠️ Must be safe to call twice, and safe to call when setUp failed halfway.
   * A ctrl-C'd run reaches here with the world in an unknown state, and residue
   * on a shared environment is the thing this exists to prevent.
   */
  tearDown?(): Promise<void>;

  /**
   * After every test, pass or fail. For per-test records a spec created.
   * Best-effort: a failure here must never fail the test.
   */
  afterEachTest?(): Promise<void>;
}

/** The default. Asserts against the app's shipped data; seeds and deletes nothing. */
export const NoTestData: TestDataProvider = {};

let cached: TestDataProvider | null = null;

/**
 * Resolve the provider named in config/app.ts.
 *
 * Lazy and cached: a run that never seeds anything must not pay for loading a
 * database client, and several hooks ask for the provider on every test.
 */
export async function testData(): Promise<TestDataProvider> {
  if (cached) return cached;

  const { APP } = await import("../../config/app");
  if (APP.testData.provider === "none") return (cached = NoTestData);

  const loaded = await import(APP.testData.provider);
  const provider: TestDataProvider = loaded.default ?? loaded;

  if (typeof provider !== "object" || provider === null)
    throw new Error(
      `config/app.ts names "${APP.testData.provider}" as the test-data provider, ` +
        `but that module exports no object implementing TestDataProvider. ` +
        `Export it as the default, or as the module itself.`,
    );

  return (cached = provider);
}
