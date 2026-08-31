/**
 * Config for the exploratory charters under test/exploratory/.
 *
 * NOT part of a regression run - wdio.conf.ts's orderedSpecs() only reads
 * test/specs/, so a charter can never join the suite by accident.
 *
 * It spreads wdio.conf.ts rather than standing alone so that it keeps the real
 * onPrepare/onComplete: a charter gets the same seeded fixture every suite gets,
 * and that fixture is torn down afterwards. Only `specs`, `exclude`, `reporters`
 * and `specFileRetries` differ.
 *
 * ⚠️ A CHARTER RUN PAYS FOR THE WHOLE FIXTURE, seeded before it and deleted after
 * it, however long your TestDataProvider takes - so run one session with the
 * charters you mean to run, rather than one charter at a time in a loop.
 *
 *   CHARTER=./test/exploratory/sweep.charter.ts npm run explore:ios
 *   npm run explore:ios          # every charter, in filename order
 *
 * `specFileRetries` is 0 here deliberately. A retry exists to survive a wedged
 * WebDriverAgent in a regression; re-running a charter re-drives the app through
 * whatever it already changed, and an exploratory session reads its evidence
 * from the FIRST attempt (rule 10, and the same reason a non-idempotent spec's
 * retries are not to be trusted - see docs/testing/suites.md).
 */
import { config as base } from "./wdio.conf";

export const config: WebdriverIO.Config = {
  ...base,
  specs: [process.env.CHARTER ?? "./test/exploratory/*.charter.ts"],
  exclude: [],
  reporters: ["spec"],
  specFileRetries: 0,
};
