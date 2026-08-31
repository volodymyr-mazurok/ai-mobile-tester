#!/usr/bin/env node
/**
 * DID THE REFACTOR CHANGE THE RUN? - resolve two wdio configs and diff them.
 *
 * ===================== WHY =====================
 * `wdio.conf.ts` went from 1,500 lines to 390 in one refactor, with the pieces
 * extracted into `config/wdio/*`. The last fully green regression finished BEFORE
 * that edit, so "the suite is green" was a statement about a file that no longer
 * existed.
 *
 * A full regression answers that in ~2 hours of device time. This answers most of
 * it in seconds, and answers the part a refactor is most likely to get wrong: the
 * DATA the runner is configured with - capabilities, spec list, exclusions,
 * timeouts, retries, reporters, mochaOpts.
 *
 * ⚠️ WHAT IT CANNOT TELL YOU. Hooks are compared by NAME AND ARITY ONLY, because
 * their bodies legitimately changed - that is what the extraction was. So this
 * proves the wiring is identical and says nothing about whether an extracted
 * helper behaves the same. It narrows what a regression has to prove; it does not
 * replace it.
 *
 *   node scripts/config-diff.cjs                    # PLATFORM from the env
 *   PLATFORM=android node scripts/config-diff.cjs
 *   node scripts/config-diff.cjs --ref <git-ref>    # default: the last commit
 *
 * Exit 0 when the resolved configs match, 1 when they differ.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.cwd();
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
// ⚠️ DEFAULTS TO HEAD, not to a pinned SHA. This used to carry the commit of one
// particular refactor - which is meaningless in any other repository, and gave a
// new clone "unknown revision 83846f7" for its very first run. `HEAD` asks the
// question this tool is actually for: does my WORKING TREE resolve to the same
// config as the last commit?
//
//   npm run config:diff                        HEAD vs the working tree
//   REF=<sha> npm run config:diff              against a specific commit
//   npm run config:diff -- --ref <sha>         the same, as a flag
const REF = arg("ref", process.env.REF || "HEAD");
const TARGET = arg("file", "wdio.conf.ts");
const BASELINE = path.join(ROOT, ".config-baseline.conf.ts");
const platform = (process.env.PLATFORM ?? "ios").toLowerCase();

/**
 * Everything comparable, with functions reduced to an identity.
 *
 * A hook's SOURCE is expected to differ; its presence and signature are not.
 * Comparing bodies would report the refactor back to us as a diff, which is the
 * one answer we already know.
 */
function normalise(value, seen = new WeakSet()) {
  if (typeof value === "function") return `fn:${value.name || "anonymous"}/${value.length}`;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => normalise(v, seen));
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, normalise(value[k], seen)]),
  );
}

/** Every leaf path where two normalised trees disagree. */
function diff(a, b, at = "", out = []) {
  const aObj = a && typeof a === "object";
  const bObj = b && typeof b === "object";
  if (!aObj || !bObj) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push([at || "(root)", a, b]);
    return out;
  }
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])])
    diff(a[key], b[key], at ? `${at}.${key}` : key, out);
  return out;
}

// Transpile only: the current config is already type-checked by `npx tsc --noEmit`,
// and the baseline is historical code we only want to EXECUTE, not re-validate.
process.env.TS_NODE_TRANSPILE_ONLY = "1";
require("ts-node/register");

let failed = false;
try {
  fs.writeFileSync(BASELINE, execFileSync("git", ["show", `${REF}:${TARGET}`], { encoding: "utf8" }));

  const current = normalise(require(path.join(ROOT, TARGET)).config);
  const base = normalise(require(BASELINE).config);
  const differences = diff(base, current);

  console.log(`config-diff  ${REF}:${TARGET}  ->  ${TARGET}   (PLATFORM=${platform})`);
  if (!differences.length) {
    console.log("\n✅ resolved configs are IDENTICAL - capabilities, specs, exclusions, timeouts,");
    console.log("   retries, reporters, mochaOpts and hook wiring all match.");
  } else {
    failed = true;
    console.log(`\n⚠️ ${differences.length} difference(s):\n`);
    for (const [where, was, now] of differences)
      console.log(
        `  ${where}\n     was: ${JSON.stringify(was)}\n     now: ${JSON.stringify(now)}`,
      );
  }
  console.log(
    "\nnote: hooks are compared by name and arity only - their bodies changed by design.\n" +
      "      This proves the WIRING, not that an extracted helper behaves the same.",
  );
} catch (error) {
  // ⚠️ THE BASELINE COMES FROM GIT, so the two ways this fails have nothing to do
  // with the config and everything to do with the repository. Reporting them as
  // themselves matters: the raw failure is a `git show` stack dump, which reads
  // like a broken tool rather than "there is no history to compare against yet".
  failed = true;
  const text = String(error?.stderr || error?.message || error);

  if (/not a git repository/i.test(text)) {
    console.error(
      `config-diff needs a git repository - it reads its baseline from ${REF}.\n\n` +
        "  This directory is not one yet. Run `git init` and make a first commit,\n" +
        "  then this can tell you whether a change altered the resolved config.",
    );
  } else if (/unknown revision|bad revision|does not exist|invalid object/i.test(text)) {
    console.error(
      `config-diff cannot resolve "${REF}" - there is no such commit.\n\n` +
        "  A repository with no commits yet has no HEAD. Commit once, or pass a\n" +
        `  ref that exists:  REF=<branch-or-sha> npm run config:diff`,
    );
  } else {
    console.error("config-diff failed:\n\n  " + text.trim().split("\n").join("\n  "));
  }
} finally {
  fs.rmSync(BASELINE, { force: true });
}
process.exit(failed ? 1 : 0);
