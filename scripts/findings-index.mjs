#!/usr/bin/env node
/**
 * What is already known - the index an exploratory session checks itself against.
 *
 * Exploration's failure mode is not missing things, it is re-reporting things
 * already written down, and burying the one new finding among them. So a
 * candidate is ranked against every place a finding could already live:
 *
 *   docs/findings/APP_ISSUES.md           open findings about the app
 *   docs/findings/TESTID_IMPROVEMENTS.md  testability asks
 *   docs/findings/BUG_REPORTS.md          the tracker-ready restatements
 *   docs/findings/COVERAGE.md             "Does not cover" - a known gap is not a finding
 *   test/specs/*.e2e.ts                   an it() title, i.e. already tested
 *   test/support/ciExclusions.ts          known local-vs-CI divergences
 *
 *   node scripts/findings-index.mjs search "en space currency"
 *   node scripts/findings-index.mjs findings          # every known finding id
 *   node scripts/findings-index.mjs gaps [screen]     # COVERAGE "does not cover"
 *   node scripts/findings-index.mjs tests [spec]      # every it() title
 *   node scripts/findings-index.mjs all               # counts, for a sanity check
 *
 * A MISS IS NOT PROOF OF NOVELTY: this matches words, and two people describe one
 * defect differently. When `search` comes back empty, read the relevant section of
 * APP_ISSUES.md before writing a new entry.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
/** Where the findings markdown lives, relative to the repo root. */
const FINDINGS = "docs/findings";
const read = (f) => {
  try {
    return fs.readFileSync(path.join(ROOT, f), "utf8");
  } catch {
    return null;
  }
};

/** Markdown files whose headings are findings, and how to recognise an id. */
const FINDING_SOURCES = [
  { file: `${FINDINGS}/APP_ISSUES.md`, kind: "app-issue", re: /^###\s+([AB]\d+[a-z]?)\.\s+(.*)$/ },
  { file: `${FINDINGS}/BUG_REPORTS.md`, kind: "reported", re: /^##\s+([ABC]\d+[a-z]?)\.\s+(.*)$/ },
  { file: `${FINDINGS}/TESTID_IMPROVEMENTS.md`, kind: "testability", re: /^##\s+(\d+[a-z]?)\.\s+(.*)$/, prefix: "#" },
];

/** Every finding: id, title, the prose under it, and where it lives. */
function findings() {
  const out = [];
  for (const src of FINDING_SOURCES) {
    const text = read(src.file);
    if (!text) continue;
    const lines = text.split("\n");
    let current = null;
    lines.forEach((line, i) => {
      const m = src.re.exec(line);
      if (m) {
        if (current) out.push(current);
        current = {
          id: `${src.prefix ?? ""}${m[1]}`,
          title: m[2].replace(/\s*[🔴🟡⚠️✅].*$/u, "").trim(),
          kind: src.kind,
          file: src.file,
          line: i + 1,
          body: "",
        };
      } else if (current) {
        current.body += line + "\n";
      }
    });
    if (current) out.push(current);
  }

  // CI exclusions are findings too - each one names a real local-vs-CI difference.
  const ci = read("test/support/ciExclusions.ts");
  if (ci) {
    const lines = ci.split("\n");
    lines.forEach((line, i) => {
      const m = /^\s{2}(C\d+):\s*\{/.exec(line);
      if (!m) return;
      const body = lines.slice(i, i + 14).join("\n");
      out.push({
        id: m[1],
        title: (/reason:\s*\n?\s*"([^"]+)/.exec(body)?.[1] ?? "").slice(0, 90),
        kind: "ci-exclusion",
        file: "test/support/ciExclusions.ts",
        line: i + 1,
        body,
      });
    });
  }
  return out;
}

/** COVERAGE.md's per-screen "Does not cover" bullets - the KNOWN gaps. */
function gaps() {
  const text = read(`${FINDINGS}/COVERAGE.md`);
  if (!text) return [];
  const out = [];
  let screen = "";
  let inGaps = false;
  text.split("\n").forEach((line, i) => {
    const h2 = /^##\s+(.+?)\s+-\s+\d+\s+tests/.exec(line);
    if (h2) {
      screen = h2[1];
      inGaps = false;
    }
    if (/^###\s+/.test(line)) inGaps = /Does not cover/i.test(line);
    if (/^#\s+/.test(line)) inGaps = false;
    if (inGaps && /^[-*]\s+/.test(line))
      out.push({ screen, text: line.replace(/^[-*]\s+/, "").trim(), file: `${FINDINGS}/COVERAGE.md`, line: i + 1 });
  });
  return out;
}

/** Every declared test, with what kind of declaration it is. */
function tests() {
  const dir = path.join(ROOT, "test/specs");
  const out = [];
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!file.endsWith(".e2e.ts")) continue;
    const spec = file.replace(/\.e2e\.ts$/, "");
    fs.readFileSync(path.join(dir, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        const m = /^\s*(it\.skip|itExceptInCI|it|describe)\s*\(\s*["'`](.+?)["'`]/.exec(line);
        if (!m) return;
        out.push({
          spec,
          kind: m[1],
          title: m[2],
          state: m[1] === "it.skip" ? "excluded" : m[1] === "itExceptInCI" ? "ci-excluded" : "running",
          file: `test/specs/${file}`,
          line: i + 1,
        });
      });
  }
  return out;
}

const STOP = new Set("the a an of is are it its and or to in on for that this with not no does do".split(" "));
const tokens = (s) =>
  [...new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];

/** Rank everything known against a query. The dedupe check. */
function search(query) {
  const q = tokens(query);
  if (!q.length) {
    console.error("search needs a term");
    process.exit(2);
  }
  const pool = [
    ...findings().map((f) => ({
      label: `${f.kind} ${f.id}`,
      title: f.title,
      haystack: `${f.id} ${f.title} ${f.body}`,
      where: `${f.file}:${f.line}`,
    })),
    ...gaps().map((g) => ({
      label: `known gap (${g.screen})`,
      title: g.text,
      haystack: `${g.screen} ${g.text}`,
      where: `${g.file}:${g.line}`,
    })),
    ...tests().map((t) => ({
      label: `test ${t.state} (${t.spec})`,
      title: t.title,
      haystack: `${t.spec} ${t.title}`,
      where: `${t.file}:${t.line}`,
    })),
  ];

  const hits = pool
    .map((item) => {
      const hay = item.haystack.toLowerCase();
      const matched = q.filter((w) => hay.includes(w));
      // Title matches are worth more than a mention buried in prose.
      const inTitle = q.filter((w) => item.title.toLowerCase().includes(w)).length;
      return { ...item, score: matched.length + inTitle, matched };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  if (!hits.length) {
    console.log(`no known finding, gap or test matches "${query}".`);
    console.log("⚠️ A MISS IS NOT PROOF OF NOVELTY - read the relevant section of");
    console.log(`   ${FINDINGS}/APP_ISSUES.md and COVERAGE.md before writing this up as new.`);
    return;
  }
  console.log(`${hits.length} possible matches for "${query}" - is your finding one of these?\n`);
  for (const h of hits)
    console.log(
      `  [${String(h.score).padStart(2)}] ${h.label.padEnd(26)} ${h.title.slice(0, 78)}\n       ${h.where}   matched: ${h.matched.join(", ")}`,
    );
}

const [cmd = "all", ...rest] = process.argv.slice(2);
const arg = rest.join(" ");

if (cmd === "findings") {
  for (const f of findings())
    console.log(`${f.id.padEnd(6)} ${f.kind.padEnd(12)} ${f.title.slice(0, 88).padEnd(90)} ${f.file}:${f.line}`);
} else if (cmd === "gaps") {
  for (const g of gaps())
    if (!arg || g.screen.toLowerCase().includes(arg.toLowerCase()))
      console.log(`${g.screen.padEnd(16)} ${g.text}`);
} else if (cmd === "tests") {
  for (const t of tests())
    if (!arg || t.spec.includes(arg))
      console.log(`${t.spec.padEnd(16)} ${t.state.padEnd(12)} ${t.kind.padEnd(9)} ${t.title}`);
} else if (cmd === "search") {
  search(arg);
} else {
  const f = findings();
  const t = tests().filter((x) => x.kind !== "describe");
  console.log(`findings   ${f.length}   (${[...new Set(f.map((x) => x.kind))].join(", ")})`);
  console.log(`known gaps ${gaps().length}  from ${FINDINGS}/COVERAGE.md`);
  console.log(
    `tests      ${t.length}   (${t.filter((x) => x.state === "running").length} running, ${t.filter((x) => x.state === "excluded").length} excluded, ${t.filter((x) => x.state === "ci-excluded").length} ci-excluded)`,
  );
  console.log(`\nusage: node scripts/findings-index.mjs <findings|gaps|tests|search> [arg]`);
}
