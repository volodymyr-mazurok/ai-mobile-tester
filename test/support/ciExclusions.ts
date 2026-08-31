/**
 * Tests that run LOCALLY but are dropped from the pipeline.
 *
 * The framework has two exclusion mechanisms and they mean different things:
 *
 *   it.skip + "[EXCLUDED <issue>]"       excluded EVERYWHERE. For behaviour that
 *                                        is broken in the app itself, so there is
 *                                        nothing to learn from running it at all.
 *
 *   itExceptInCI + "[CI-EXCLUDED <id>]"  excluded IN THE PIPELINE ONLY. For a test
 *                                        that genuinely passes on a real device
 *                                        and cannot be made to pass on a hosted
 *                                        agent. THIS FILE.
 *
 * Policy: docs/testing/suites.md#exclusion-policy. Rule 16 - this is a LAST RESORT,
 * because it hides a local-versus-CI divergence by construction. A green pipeline
 * whose green depends on not running things is worth less than a red one that tells
 * you the truth. One or two entries is a list; ten is a pipeline that has stopped
 * measuring anything.
 *
 * The mechanism enforces what it can. An id with no CI_EXCLUSIONS entry throws, so
 * an exclusion cannot be added without a written reason; every skip is logged at the
 * moment it happens, so a run says what it left out; and RUN_CI_EXCLUDED=true runs
 * them anyway, which is how an entry gets retired.
 *
 * ⚠️ THREE THINGS THE PREDECESSOR PROJECT LEARNED BY GETTING THEM WRONG:
 *
 *  - One entry was nearly added while the real cause was `adb` missing from the
 *    pipeline's PATH - a one-line environment bug. Excluding it would have
 *    permanently hidden a fault that took a minute to fix. Find the cause first.
 *  - Another's reason ("passes locally every run") turned out to be an accident of
 *    how many app relaunches happened to precede it; the same symptom was later
 *    filed as an app bug. An exclusion is a hypothesis with an expiry date - write
 *    down what would settle it.
 *  - This is NOT a tool for run-to-run variance. Three consecutive hosted runs of
 *    one suite produced three largely DISJOINT failure sets, so excluding a run's
 *    failures would have deleted real coverage and the next run would have failed a
 *    different set. It is for a test that fails REPRODUCIBLY on a hosted agent.
 */

interface CiExclusion {
  /** What is DIFFERENT ABOUT CI - see the header. Not "flaky in CI". */
  reason: string;
  /**
   * Exclude on this platform only. Omit to exclude on both.
   *
   * ⚠️ SCOPE EVERY ENTRY AS NARROWLY AS THE EVIDENCE DOES. The entry this field
   * was added for failed on a hosted macOS agent and passed on the hosted Linux
   * one; excluding it on both would have thrown away a platform's worth of real,
   * working coverage to describe a problem only one platform had.
   */
  platform?: "ios" | "android";
}

/** Every id excluded here, with why - kept together so the list is readable. */
export const CI_EXCLUSIONS: Record<string, CiExclusion> = {};

/**
 * True when this process is a pipeline run.
 *
 * ⚠️ RUN_CI_EXCLUDED=true DELIBERATELY MAKES THIS FALSE, so a pipeline can be asked
 * to run the excluded tests for one build. That is why capabilities.ts uses
 * pipelineVar.inPipeline() instead where it needs "is there a hosted agent
 * underneath us" - a question this one is designed to lie about.
 */
export function inCI(): boolean {
  if (process.env.RUN_CI_EXCLUDED === "true") return false;
  return Boolean(process.env.TF_BUILD || process.env.CI);
}

/**
 * `it(...)` locally, `it.skip(...)` in CI - reported as PENDING, never as passed.
 *
 * The title always carries the `[CI-EXCLUDED <id>]` prefix, on BOTH platforms and in
 * both modes, so the test has one name everywhere: a `--mochaOpts.grep`, an external
 * case id and a results diff all keep working across the boundary.
 *
 *   itExceptInCI("C1", "uploads a file from the device", async () => { ... });
 */
export function itExceptInCI(
  id: string,
  title: string,
  fn: Mocha.AsyncFunc,
): Mocha.Test {
  const entry = CI_EXCLUSIONS[id];
  if (!entry)
    throw new Error(
      `itExceptInCI("${id}", ...) has no entry in CI_EXCLUSIONS. Add one naming ` +
        `what is different about CI - see test/support/ciExclusions.ts.`,
    );

  const fullTitle = `[CI-EXCLUDED ${id}] ${title}`;
  if (!inCI()) return it(fullTitle, fn);

  // ⚠️ Read from the ENV, not from `browser.isIOS`. This runs while the spec file
  // is being loaded to build the suite, which is a different moment from a test
  // body executing - and it must agree exactly with how wdio.conf.ts picks the
  // platform, so the same default (`ios`) is applied here.
  const platform = (process.env.PLATFORM ?? "ios").toLowerCase();
  if (entry.platform && entry.platform !== platform) return it(fullTitle, fn);

  console.log(
    `[ci-excluded] SKIPPED "${title}" (${id}` +
      `${entry.platform ? `, ${entry.platform} only` : ""}): ${entry.reason}\n` +
      `[ci-excluded]   it still runs locally; RUN_CI_EXCLUDED=true runs it here too.`,
  );
  return it.skip(fullTitle, fn);
}
