/**
 * Turn the last run into one self-contained HTML report.
 *
 *   npm run report                 # the platform of the last run
 *   npm run report -- --platform android
 *   npm run report -- --open       # ...and open it
 *
 * Reads what a run already leaves behind and joins it up:
 *
 *   test-results/cost-<platform>.jsonl   verdicts + driver calls, per test
 *   errorShots/*.png                     a picture of every failure
 *   docs/findings/APP_ISSUES.md          defects somebody confirmed by hand
 *   docs/findings/COVERAGE.md            what the suite does NOT check
 *
 * ⚠️ SELF-CONTAINED ON PURPOSE. Screenshots are inlined as data: URIs so the
 * file can be attached to a ticket, mailed, or opened from a CI artifact drop
 * with nothing alongside it. A report that only renders next to its own folder
 * is a report nobody forwards.
 *
 * ⚠️ FIRST ATTEMPT WINS. wdio retries a whole spec FILE, so a retry of a
 * non-idempotent suite manufactures failures that never happened (rule 10).
 * Every attempt is recorded; this keeps the first occurrence of each title and
 * counts the rest only to flag the test as unstable.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const RESULTS = path.join(ROOT, "test-results");
const SHOTS = path.join(ROOT, "errorShots");
const OUT_DIR = path.join(ROOT, "reports");

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

// ── inputs ────────────────────────────────────────────────────────────────────

function pickPlatform() {
  const explicit = arg("platform");
  if (explicit) return explicit;
  const files = fs.existsSync(RESULTS)
    ? fs.readdirSync(RESULTS).filter((f) => /^cost-.*\.jsonl$/.test(f))
    : [];
  if (!files.length) return null;
  // Most recently written, so `npm run report` after a run needs no argument.
  return files
    .map((f) => ({ f, m: fs.statSync(path.join(RESULTS, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0]
    .f.replace(/^cost-|\.jsonl$/g, "");
}

function readRecords(platform) {
  const file = path.join(RESULTS, `cost-${platform}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return []; // a half-written line from a killed run is not worth failing over
      }
    });
}

/**
 * First attempt of each test, plus whether the retry disagreed with it. Rule 10.
 *
 * ⚠️ `attempts > 1` IS NOT INSTABILITY. wdio retries a whole spec FILE, so one
 * failing test drags every other test in the file through a second run. Counting
 * those as flaky reported every OTHER test in a spec as unstable because one of
 * them had found a real bug - an alarm generated entirely by the reporting.
 *
 * A test is unstable only when its attempts DISAGREE: passed once and failed
 * once. Failing twice is a consistent failure, and passing twice is a test that
 * was along for the ride.
 */
function firstAttempts(records) {
  const seen = new Map();
  for (const r of records) {
    const existing = seen.get(r.title);
    if (existing) {
      existing.attempts += 1;
      if (existing.passed !== r.passed) existing.unstable = true;
    } else {
      seen.set(r.title, { ...r, attempts: 1, unstable: false });
    }
  }
  return [...seen.values()];
}

/** The newest errorshot whose filename carries this test's title. */
function shotFor(title) {
  if (!fs.existsSync(SHOTS)) return null;
  const slug = title.replace(/[^a-z0-9]+/gi, "_").slice(0, 120);
  const hit = fs
    .readdirSync(SHOTS)
    .filter((f) => f.endsWith(".png") && f.includes(slug))
    .sort()
    .pop();
  return hit ? path.join(SHOTS, hit) : null;
}

const dataUri = (file) =>
  `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

/** `### A1. summary` out of APP_ISSUES.md - the same shape findings-index reads. */
function appIssues() {
  const file = path.join(ROOT, "docs/findings/APP_ISSUES.md");
  if (!fs.existsSync(file)) return [];
  return [...fs.readFileSync(file, "utf8").matchAll(/^###\s+(A\d+[a-z]?)\.\s+(.+)$/gm)].map(
    (m) => ({ id: m[1], summary: m[2].trim() }),
  );
}

/** Per-screen "Does not cover" bullets - the gaps, which are the useful half. */
function coverage() {
  const file = path.join(ROOT, "docs/findings/COVERAGE.md");
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const out = [];
  for (const m of text.matchAll(/^##\s+(.+?)\s+-\s+(\d+)\s+tests\s*$/gm)) {
    const rest = text.slice(m.index);
    const covers = (rest.match(/### Covers\n([\s\S]*?)(?=\n###|\n##|$)/) || [, ""])[1];
    const gaps = (rest.match(/### Does not cover\n([\s\S]*?)(?=\n###|\n##|$)/) || [, ""])[1];
    const bullets = (block) => (block.match(/^- /gm) || []).length;
    out.push({
      screen: m[1],
      tests: Number(m[2]),
      covers: bullets(covers),
      gaps: bullets(gaps),
    });
  }
  return out;
}

// ── render ────────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} с` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function render({ platform, tests, issues, cov, generatedAt }) {
  const passed = tests.filter((t) => t.passed);
  const failed = tests.filter((t) => !t.passed);
  const totalMs = tests.reduce((n, t) => n + (t.durationMs || 0), 0);
  const flaky = tests.filter((t) => t.unstable);

  const bySuite = new Map();
  for (const t of tests) {
    const key = t.suite || "—";
    if (!bySuite.has(key)) bySuite.set(key, []);
    bySuite.get(key).push(t);
  }

  const tile = (n, label, tone = "") =>
    `<div class="tile ${tone}"><b>${n}</b><span>${label}</span></div>`;

  return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Звіт прогону · ${esc(platform)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
 :root{--emerald:#1B7F55;--emerald-deep:#0A3324;--accent:#34D782;--accent-ink:#0A3324;
   --slate:#17232E;--paper:#EFF4F4;--surface:#fff;--surface-2:#E3ECEC;--ink:#101A21;
   --ink-2:#39505B;--muted:#66808B;--line:#D3E0E0;--fail:#C8452F;--pass:#2F8F5B;
   --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;color-scheme:light}
 *{box-sizing:border-box}
 body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 "Golos Text",-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
 .wrap{max-width:1000px;margin:0 auto;padding:0 28px 80px}
 .hd{background:linear-gradient(103deg,var(--emerald),var(--emerald-deep));color:#fff;
   border-radius:0 0 20px 20px;padding:38px 40px 34px;margin:0 -28px 34px}
 .hd .k{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 12px}
 .hd h1{margin:0 0 8px;font-size:34px;font-weight:800;letter-spacing:-.028em}
 .hd p{margin:0;color:rgba(255,255,255,.82);font-size:15px}
 .hd .meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
 .hd .meta span{font-size:12.5px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.22)}
 h2{font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);
   margin:44px 0 16px;padding-bottom:10px;border-bottom:1px solid var(--line)}
 .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:16px}
 .tile{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:20px 22px}
 .tile b{display:block;font-size:32px;font-weight:800;letter-spacing:-.026em;line-height:1.05;font-variant-numeric:tabular-nums}
 .tile span{display:block;font-size:12.5px;color:var(--muted);margin-top:6px}
 .tile.ok b{color:var(--pass)} .tile.bad b{color:var(--fail)} .tile.dim b{color:var(--ink-2)}
 table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:13px;overflow:hidden;font-size:14.5px}
 th{font-size:10.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);
   text-align:left;padding:13px 18px;background:var(--surface-2);border-bottom:1px solid var(--line)}
 td{padding:12px 18px;border-bottom:1px solid var(--line);vertical-align:middle;color:var(--ink-2)}
 tr:last-child td{border-bottom:0}
 td.t{color:var(--ink);font-weight:500}
 .v{font-family:var(--mono);font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
 .v.pass{background:#E2F1E9;color:var(--pass)} .v.fail{background:#FBEAE6;color:var(--fail)}
 /* A numeric column is sized by its own content, not by an equal share of the
    table: width:1% plus nowrap collapses it to the wider of its header and its
    digits, and the first text column absorbs all the slack. Without this the
    four columns split the full width evenly and a header sits ~150px from the
    number underneath it. */
 .n{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;
   white-space:nowrap;width:1%}
 /* ⚠️ THE HEADER MUST SHARE THE CELL'S ALIGNMENT, or the column name and its
    value hang off opposite edges. A th defaults to left for text columns; a
    numeric one overrides it here, and the two share the same 18px padding so
    the digits line up under the last letter of the label. */
 th.n{text-align:right}
 /* An id is a label, not a quantity: monospaced like a number, aligned like text. */
 .id{font-family:var(--mono);white-space:nowrap;width:1%}
 .fail-card{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--fail);
   border-radius:12px;padding:22px 24px;margin:16px 0;display:grid;grid-template-columns:180px 1fr;gap:26px;align-items:start}
 .fail-card img{width:100%;border-radius:8px;border:1px solid var(--line);display:block}
 .fail-card h3{margin:0 0 6px;font-size:17px;font-weight:700}
 .fail-card pre{margin:10px 0 0;background:#0A1418;color:#F0806E;border-radius:8px;padding:14px 16px;
   font-family:var(--mono);font-size:12.5px;overflow-x:auto;white-space:pre-wrap}
 .fail-card .where{font-size:13px;color:var(--muted);font-family:var(--mono)}
 .empty{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:22px 24px;color:var(--muted);font-size:14.5px}
 .foot{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:12px 26px;justify-content:space-between}
 code{font-family:var(--mono);font-size:.88em;background:var(--surface-2);border:1px solid var(--line);padding:1px 5px;border-radius:4px}
 @media(max-width:640px){.fail-card{grid-template-columns:1fr}}
 @media print{body{background:#fff}.hd,.tile,.fail-card{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="wrap">

<div class="hd">
  <p class="k">AI Mobile App Tester</p>
  <h1>Звіт прогону</h1>
  <p>${failed.length === 0
      ? "Усі перевірки пройдено."
      : `${failed.length} ${failed.length === 1 ? "перевірка не пройшла" : "перевірки не пройшли"} — деталі й скріншоти нижче.`}</p>
  <div class="meta">
    <span>Платформа · ${esc(platform)}</span>
    <span>${esc(generatedAt)}</span>
    <span>${tests.length} перевірок</span>
  </div>
</div>

<h2>Підсумок</h2>
<div class="tiles">
  ${tile(tests.length, "перевірок", "dim")}
  ${tile(passed.length, "пройшли", "ok")}
  ${tile(failed.length, "не пройшли", failed.length ? "bad" : "dim")}
  ${tile(fmtDuration(totalMs), "у тестах", "dim")}
  ${tile(bySuite.size, "наборів", "dim")}
</div>

<h2>Що не пройшло</h2>
${
  failed.length === 0
    ? `<div class="empty">Нічого. Кожна перевірка цього прогону пройшла.</div>`
    : failed
        .map((t) => {
          const shot = shotFor(t.title);
          return `<div class="fail-card">
  ${shot ? `<img src="${dataUri(shot)}" alt="Екран у момент падіння">` : `<div class="empty">Скріншот не збережено</div>`}
  <div>
    <h3>${esc(t.title)}</h3>
    <p class="where">${esc(t.suite)} · ${esc(t.file)}</p>
    <pre>${esc(t.error || "без повідомлення")}</pre>
  </div>
</div>`;
        })
        .join("\n")
}

<h2>За наборами</h2>
<table><thead><tr><th>Набір</th><th class="n">Перевірок</th><th class="n">Пройшло</th><th class="n">Не пройшло</th></tr></thead><tbody>
${[...bySuite.entries()]
  .map(([suite, ts]) => {
    const f = ts.filter((t) => !t.passed).length;
    return `<tr><td class="t">${esc(suite)}</td><td class="n">${ts.length}</td>
    <td class="n">${ts.length - f}</td>
    <td class="n">${f ? `<span class="v fail">${f}</span>` : "—"}</td></tr>`;
  })
  .join("\n")}
</tbody></table>

${
  flaky.length
    ? `<h2>Нестабільні</h2><table><thead><tr><th>Перевірка</th><th class="n">Спроб</th></tr></thead><tbody>
${flaky.map((t) => `<tr><td class="t">${esc(t.title)}</td><td class="n">${t.attempts}</td></tr>`).join("\n")}
</tbody></table>
<p style="font-size:13px;color:var(--muted);margin-top:12px">Ці перевірки дали різний результат у двох спробах. Показано вердикт ПЕРШОЇ: повтор файлу специфікації створює падіння, яких не було.</p>`
    : ""
}

<h2>Підтверджені дефекти застосунку</h2>
${
  issues.length
    ? `<table><thead><tr><th>ID</th><th>Дефект</th></tr></thead><tbody>
${issues.map((i) => `<tr><td class="id"><code>${esc(i.id)}</code></td><td class="t">${esc(i.summary)}</td></tr>`).join("\n")}
</tbody></table>
<p style="font-size:13px;color:var(--muted);margin-top:12px">Кожен відтворено вручну перед записом.</p>`
    : `<div class="empty">Жодного підтвердженого дефекту не записано.</div>`
}

${
  cov.length
    ? `<h2>Покриття</h2><table><thead><tr><th>Екран</th><th class="n">Тестів</th><th class="n">Перевіряє</th><th class="n">Не перевіряє</th></tr></thead><tbody>
${cov.map((c) => `<tr><td class="t">${esc(c.screen)}</td><td class="n">${c.tests}</td><td class="n">${c.covers}</td><td class="n">${c.gaps}</td></tr>`).join("\n")}
</tbody></table>
<p style="font-size:13px;color:var(--muted);margin-top:12px">Колонка «не перевіряє» — цілі для наступної дослідницької сесії.</p>`
    : ""
}

<div class="foot">
  <span>Згенеровано <code>npm run report</code> з артефактів прогону</span>
  <span>${esc(generatedAt)} · ${esc(platform)}</span>
</div>
</div></body></html>`;
}

// ── main ──────────────────────────────────────────────────────────────────────

const platform = pickPlatform();
if (!platform) {
  console.error(
    "No run to report on - test-results/cost-<platform>.jsonl is missing.\n" +
      "Run the suite first (npm run wdio:android), then npm run report.",
  );
  process.exit(1);
}

const records = readRecords(platform);
if (!records.length) {
  console.error(`cost-${platform}.jsonl is empty - did the run reach any tests?`);
  process.exit(1);
}

const tests = firstAttempts(records);
const html = render({
  platform,
  tests,
  issues: appIssues(),
  cov: coverage(),
  generatedAt: new Date(records[records.length - 1].at).toLocaleString("uk-UA", {
    dateStyle: "long",
    timeStyle: "short",
  }),
});

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `report-${platform}.html`);
fs.writeFileSync(out, html);

const failed = tests.filter((t) => !t.passed).length;
console.log(
  `[report] ${out}\n` +
    `[report] ${tests.length} tests, ${tests.length - failed} passed, ${failed} failed, ` +
    `${tests.reduce((n, t) => n + (t.calls || 0), 0).toLocaleString("en-US")} driver calls`,
);

if (argv.includes("--open")) {
  try {
    execFileSync(process.platform === "darwin" ? "open" : "xdg-open", [out]);
  } catch {
    /* opening is a convenience */
  }
}
