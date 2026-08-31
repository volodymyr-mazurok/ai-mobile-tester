import fs from "node:fs";
import path from "node:path";
import { RESULTS_DIR } from "./artifacts";

/**
 * ONE MACHINE-READABLE LINE PER TEST, so a run can be reported on afterwards.
 *
 * The JUnit XML the reporter writes has the verdicts and the durations but NOT
 * the driver-call count, and its `system-out` is capped part-way through a test,
 * so counting `COMMAND:` lines out of it silently under-reports. `[cost]` is
 * printed to stdout and stdout is not kept. Without this file the only figure
 * that means the same thing on a laptop and on a CI agent (rule 9) is gone the
 * moment the terminal scrolls.
 *
 * ⚠️ APPEND-ONLY JSONL, one file per platform, and deliberately not JSON. Each
 * spec file runs in its OWN worker process, so several writers share this file;
 * appending a single short line is safe under that, and rewriting a parsed
 * array would have workers clobbering each other's results.
 *
 * ⚠️ EVERY ATTEMPT IS RECORDED, including a spec-file retry's. Deduplicating
 * here would be the wrong place to do it: `scripts/report.mjs` keeps the FIRST
 * occurrence of each title, because rule 10 says the first attempt's failure is
 * the real one and a retry of a non-idempotent suite manufactures failures that
 * never happened. Recording only the first would also hide a flaky test, which
 * is worth seeing.
 *
 * Never throws. A report is a convenience; losing one must not fail a run.
 */
export interface TestRecord {
  /** The `it()` title, as written. Also how the report joins to an errorshot. */
  title: string;
  /** The `describe()` it sits in, for grouping. */
  suite: string;
  /** Spec file, relative to the repo root. */
  file: string;
  passed: boolean;
  /** Driver calls in the test BODY - the cost figure rule 9 ranks by. */
  calls: number;
  /** Wall clock, milliseconds. Comparable only against the same machine. */
  durationMs: number;
  /** First line of the failure, when there is one. */
  error?: string;
  /** ISO, so the report can order attempts without guessing. */
  at: string;
}

export const recordPath = (platform: string): string =>
  path.join(RESULTS_DIR, `cost-${platform}.jsonl`);

/** Start a clean file for this platform. Called once, from `onPrepare`. */
export function beginRun(platform: string): void {
  try {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(recordPath(platform), "");
  } catch {
    /* a report is a convenience - never fail a run over one */
  }
}

/** Append one test's outcome. Called from `afterTest`. */
export function recordTest(platform: string, record: TestRecord): void {
  try {
    fs.appendFileSync(recordPath(platform), `${JSON.stringify(record)}\n`);
  } catch {
    /* see above */
  }
}
