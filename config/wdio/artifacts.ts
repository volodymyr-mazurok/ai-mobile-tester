/**
 * Run output: the failure screenshot, and where each artifact goes.
 *
 * ⚠️ THE PLATFORM IS IN EVERY FILENAME, and the DIRECTORY names deliberately are
 * not. Two runs on one machine - an iOS suite and an Android one, in parallel or back
 * to back - otherwise write the identical set of filenames and the second destroys
 * the first's evidence. Both halves of that were measured: an Android run's
 * appium.log was gone before anyone read it (Appium opens it with truncation, and
 * per-endpoint cost is the one thing only that file records), and `results-0-8.xml`
 * sat in an otherwise-iOS report as a stale Android result. A mixed-platform results
 * directory is worse than a missing one - it reads as complete.
 *
 * ⚠️ THE DIRECTORY NAMES ARE A CI CONTRACT. A pipeline publishes `logs/` and
 * `test-results/` wholesale and globs `test-results/*.xml` (see docs/guides/ci.md),
 * so renaming a FOLDER breaks artifact collection. Renaming the files inside one is
 * invisible to CI, which is why the platform goes in the filename.
 *
 * ⚠️ A spec-file retry USED TO overwrite its own first attempt's XML - same cid, same
 * filename - so attempt 1's failure survived only in stdout. That is what
 * `resultsFileName` and `clearPreviousResults` below now prevent; stdout is still
 * worth redirecting, but it is no longer the only copy.
 */
import fs from "node:fs";
import path from "node:path";

export const LOG_DIR = "./logs";
export const RESULTS_DIR = "./test-results";
export const ERRORSHOT_DIR = "./errorShots";

export const appiumLogPath = (platform: string) => `${LOG_DIR}/appium-${platform}.log`;

/**
 * The results filename for one runner - and a DIFFERENT one for each attempt at it.
 *
 * ⚠️ WHY THIS IS NOT JUST A TEMPLATE STRING. A spec-file retry is a new runner with
 * the SAME cid, so `results-ios-0-1.xml` was written twice and the retry destroyed
 * the first attempt's evidence - and for a NON-IDEMPOTENT spec that is the worse of
 * the two copies, because its retry reports failures attempt 1 did not have (a list
 * the first attempt left an item in, a count pushed past a window). A regression then
 * reads as 4 failures when it had 1. Rule 10.
 *
 * So: keep the plain name for the first attempt - CI's `test-results/*.xml` glob and
 * every existing reader stay unchanged - and only suffix a retry. Collision detection
 * is by file existence, which is why `clearPreviousResults` has to run first; without
 * it a previous run's leftovers would push attempt 1 to `.attempt2`.
 */
export const resultsFileName = (platform: string, cid: string) => {
  const base = `results-${platform}-${cid}`;
  if (!fs.existsSync(path.join(RESULTS_DIR, `${base}.xml`))) return `${base}.xml`;
  for (let attempt = 2; attempt < 20; attempt += 1) {
    const name = `${base}.attempt${attempt}.xml`;
    if (!fs.existsSync(path.join(RESULTS_DIR, name))) return name;
  }
  return `${base}.attempt-overflow.xml`;
};

/**
 * Move THIS platform's results from a previous run aside, and only this platform's.
 *
 * Two reasons, and the second is the one that bites. A stale `results-ios-0-7.xml`
 * from a longer previous run sits in a shorter run's report and reads as complete -
 * the same "a mixed directory is worse than a missing one" hazard the header note is
 * about. And `resultsFileName` decides "is this a retry?" by asking whether the file
 * is already there, so leftovers would misname attempt 1.
 *
 * The platform filter is deliberate: an iOS suite and an Android suite run back to
 * back on one machine, and neither may touch the other's evidence.
 *
 * ⚠️ MOVED, NOT DELETED, and that is not tidiness. The first version of this deleted,
 * and it destroyed a finished regression's results twice on the day it was written -
 * once because wdio.explore.conf.ts inherits onPrepare (now guarded), and once
 * legitimately, on a re-run, while those results were still the only copy of what a
 * report had been written from. A previous run's XML costs nothing to keep and is the
 * only machine-readable record of it.
 *
 * `PREVIOUS_RESULTS_DIR` is a SUBDIRECTORY on purpose: CI publishes
 * `test-results/*.xml`, which does not recurse, so nothing here reaches a report.
 */
export const PREVIOUS_RESULTS_DIR = `${RESULTS_DIR}/previous`;

export function clearPreviousResults(platform: string): void {
  try {
    if (!fs.existsSync(RESULTS_DIR)) return;
    const stale = fs
      .readdirSync(RESULTS_DIR)
      .filter((file) => file.startsWith(`results-${platform}-`) && file.endsWith(".xml"));
    if (!stale.length) return;
    fs.mkdirSync(PREVIOUS_RESULTS_DIR, { recursive: true });
    for (const file of stale) {
      // One slot per platform, overwritten each run: this keeps the LAST run, which is
      // what a "wait, what did it say before?" actually needs. Keeping every run would
      // grow without bound and nothing prunes it.
      fs.rmSync(path.join(PREVIOUS_RESULTS_DIR, file), { force: true });
      fs.renameSync(path.join(RESULTS_DIR, file), path.join(PREVIOUS_RESULTS_DIR, file));
    }
    console.log(
      `[run] moved ${stale.length} ${platform} result file(s) from the previous run to ${PREVIOUS_RESULTS_DIR}/`,
    );
  } catch {
    /* a results directory we cannot tidy is not a reason to fail the run */
  }
}

/**
 * Save a screenshot of whatever is on screen.
 *
 * Best-effort throughout: a failure here must never become the failure the run
 * reports. Returns the buffer so a caller that wants to attach the same image
 * somewhere else can reuse it rather than taking a second capture.
 */
export async function saveFailureScreenshot(
  label: string,
  platform: string,
): Promise<Buffer | undefined> {
  try {
    if (!fs.existsSync(ERRORSHOT_DIR)) fs.mkdirSync(ERRORSHOT_DIR, { recursive: true });
    const safeName = label.replace(/[^a-z0-9]+/gi, "_").slice(0, 120);
    const buffer = Buffer.from(await browser.takeScreenshot(), "base64");
    fs.writeFileSync(`${ERRORSHOT_DIR}/${Date.now()}-${platform}-${safeName}.png`, buffer);
    return buffer;
  } catch {
    return undefined;
  }
}
