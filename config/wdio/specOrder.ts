/**
 * Which specs run, and in what order.
 *
 * ⚠️ AUTHENTICATED FIRST, PRE-AUTH LAST, and that ordering is load-bearing when
 * your suites share a session. The signed-in session survives the relaunch
 * afterSuite does between spec files, so the authenticated suites share a single
 * sign-in - which matters because signing in is the flakiest thing any mobile
 * suite does. A pre-auth suite deliberately signs OUT, so anything authenticated
 * running after one would have to sign in all over again.
 *
 * Built by READING THE DIRECTORY rather than listing files, so a newly added spec
 * cannot be silently left out of the run. Alphabetical within each group.
 *
 * See docs/testing/suites.md.
 */
import fs from "node:fs";

const SPEC_DIR = "./test/specs";

/**
 * ⚠️ EDIT THIS FOR YOUR APP. Spec-file basenames (no `.e2e.ts`) that sign the
 * app OUT, and must therefore run last. Leave it empty if none of yours do.
 */
const PRE_AUTH_SPECS = ["login"];

/**
 * SPEC_FILTER accepts a single name, "all", a comma-separated list, or
 * `not:<a>,<b>`.
 *
 * ⚠️ Applied HERE rather than as `--spec` on the command line, because an
 * explicit --spec list overrides wdio's own `specs` and with it the ordering
 * above. It exists because a full regression does not always fit one CI job: in
 * the predecessor project a single heavy suite took 62 of a 147-minute run, so
 * splitting it across two jobs was the only way to stay under the ceiling.
 *
 * ⚠️ TWO FILTERED RUNS ARE ONLY INDEPENDENT IF YOUR FIXTURE MAKES THEM SO. They
 * share whatever onPrepare seeds. See docs/architecture/test-data.md.
 *
 *   SPEC_FILTER=checkout          one heavy spec
 *   SPEC_FILTER=not:checkout      everything else, still in the right order
 */
function specFilter(): (file: string) => boolean {
  const filter = (process.env.SPEC_FILTER ?? "all").trim();
  const names = (list: string) =>
    list
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

  const wanted = filter.startsWith("not:")
    ? { skip: names(filter.slice(4)), only: [] as string[] }
    : { skip: [] as string[], only: filter === "all" ? [] : names(filter) };

  return (file: string): boolean => {
    const name = file.replace(/\.e2e\.ts$/, "");
    if (wanted.skip.length) return !wanted.skip.includes(name);
    if (wanted.only.length) return wanted.only.includes(name);
    return true;
  };
}

export function orderedSpecs(): string[] {
  const isPreAuth = (file: string) =>
    PRE_AUTH_SPECS.some((name) => file.startsWith(`${name}.`));
  const chosen = specFilter();

  // ⚠️ Tolerate an absent specs/ directory. A fresh clone of this boilerplate
  // has none until the first spec is written, and `readdirSync` on a missing
  // path throws ENOENT out of wdio's config load - which reads like a broken
  // install rather than "you have not written a test yet".
  if (!fs.existsSync(SPEC_DIR)) return [];

  return fs
    .readdirSync(SPEC_DIR)
    .filter((file) => file.endsWith(".e2e.ts"))
    .filter(chosen)
    .sort(
      (a, b) => Number(isPreAuth(a)) - Number(isPreAuth(b)) || a.localeCompare(b),
    )
    .map((file) => `${SPEC_DIR}/${file}`);
}
