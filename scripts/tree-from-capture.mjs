#!/usr/bin/env node
// Build an element tree from a live accessibility-tree capture, and diff it
// against the committed page objects so you can see exactly what the app
// added, renamed or removed.
//
//   npm run capture:tree                 # reads ./.inspect
//   npm run capture:tree -- path/to/dir
//
// Produce a capture first with the `inspect-live-screen` skill - it writes
// page-source XML per screen. testIDs surface as `name` on iOS and
// `resource-id` on Android, so either platform's dump works.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIR = path.resolve(process.argv[2] ?? path.join(ROOT, ".inspect"));

if (!fs.existsSync(DIR)) {
  console.error(`No capture directory at ${DIR}.\nRun the inspect-live-screen skill first.`);
  process.exit(1);
}

// ---- 1. testIDs present in the capture --------------------------------------
const ID = /(?:name|resource-id)="([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"/g;
// Asset filenames ("deer.png") look exactly like a dotted testID.
const ASSET = /\.(png|jpe?g|gif|svg|webp|pdf|mp4)$/i;
const captured = new Set();
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith(".xml"))) {
  for (const m of fs.readFileSync(path.join(DIR, f), "utf8").matchAll(ID)) {
    if (!ASSET.test(m[1])) captured.add(m[1]);
  }
}
if (!captured.size) {
  console.error(`No dotted testIDs found in ${DIR}/*.xml`);
  process.exit(1);
}

// ---- 2. testIDs the page objects already declare ----------------------------
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs" },
});

// Page objects import @wdio/globals, which can't load outside a wdio run - and
// nothing here needs it, since we only read declared SELECTORS, never resolve
// them. Stub it so the modules import cleanly.
const Module = require("module");
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "@wdio/globals")
    return { $: () => ({}), $$: async () => [], browser: { isIOS: true }, driver: {} };
  return origLoad.call(this, request, ...rest);
};

const declared = new Set(); // byTestId - literal ids
const declaredWildcards = new Set(); // byRecordId prefixes - cover every row id
const covered = new Set(); // ids reached by a byTestIdEnding shape under a parent
for (const f of fs.readdirSync(path.join(ROOT, "test/pageobjects"))) {
  if (!f.endsWith(".page.ts") && f !== "page.ts") continue;
  let mod;
  try {
    mod = require(path.join(ROOT, "test/pageobjects", f));
  } catch (err) {
    console.warn(`  (skipped ${f}: ${err.message.split("\n")[0]})`);
    continue;
  }
  // Every page object default-exports a Component instance; named exports can
  // be further pages (one page-object file may export several screens).
  for (const exported of Object.values(mod)) {
    if (!exported || typeof exported.aliases === "undefined") continue;
    (function walk(node, parentIds) {
      const selector = node.selector?.ios;
      let ownIds = [];
      const reached = [];
      if (selector) {
        // byTestId, one or many: @name="a" or @name="b"
        ownIds = [...selector.matchAll(/@name="([^"]+)"/g)].map(([, id]) => id);
        for (const id of ownIds) declared.add(id);
        // byRecordId: rows keyed by a runtime id under a fixed prefix
        const record = selector.match(/starts-with\(@name,"([^"]+)\."\)/);
        if (record) declaredWildcards.add(record[1]);
        // byTestIdEnding: relative, so it has no id of its own - work out which
        // ids it actually reaches, given the parent it resolves inside. A part
        // of the ROW `settings.notify.smsToggle` is `...smsToggle.checkedIcon`;
        // a part of the CARD `home.assets.card` is `home.assets.leftValue`,
        // because the card is a sibling of its own contents' naming.
        for (const [, tail] of selector.matchAll(/string-length\(@name\)[^=]*= "(\.[^"]+)"/g)) {
          for (const parent of parentIds) {
            // Either the child hangs off the parent's own id
            // (settings.logoutButton + .label) or off the id the parent is a
            // sibling of (home.assets.card -> home.assets + .leftValue).
            // Both are recorded; a candidate that doesn't exist suppresses
            // nothing, since it can't appear in the capture either.
            reached.push(parent + tail, parent.replace(/\.[^.]+$/, "") + tail);
          }
        }
        for (const id of reached) covered.add(id);
      }
      // A relative node has no literal id, so pass on what it actually reaches -
      // otherwise its own children lose the chain (a checkbox row is relative,
      // and its parts are relative to the row).
      const inherited = ownIds.length ? ownIds : reached.length ? reached : parentIds;
      for (const alias of node.aliases) walk(node.child(alias), inherited);
    })(exported, []);
  }
}

// A captured id under a declared collection is covered by its "*" node.
const underWildcard = (id) =>
  [...declaredWildcards].some((w) => id.startsWith(`${w}.`));

// ---- 3. skeleton ------------------------------------------------------------
// Group the captured ids by their leading prefix, so each group can be pasted
// as a component: the prefix is stated once and every child is just its tail.
const groups = new Map();
for (const id of [...captured].sort()) {
  const segments = id.split(".");
  const prefix = segments.length > 1 ? segments.slice(0, -1).join(".") : "";
  const tail = segments[segments.length - 1];
  if (!groups.has(prefix)) groups.set(prefix, []);
  groups.get(prefix).push({ tail, id });
}

const humanise = (tail) =>
  tail
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

function skeleton() {
  const out = [];
  for (const [prefix, entries] of [...groups].sort()) {
    if (!prefix) continue;
    // a numeric segment means a runtime-keyed list, not a real prefix
    if (/\.\d+$/.test(prefix) || /^\d+$/.test(prefix.split(".").pop())) continue;
    out.push(`  // ${prefix}`);
    out.push(`  super({ alias: "TODO", prefix: "${prefix}", selector: byTestId("${prefix}.TODO") });`);
    for (const { tail } of entries) {
      out.push(`  this.defineComponent({ alias: "${humanise(tail)}", selector: "${tail}" });`);
    }
    out.push("");
  }
  return out.join("\n");
}

// ---- 4. report --------------------------------------------------------------
const added = [...captured].filter(
  (id) =>
    !declared.has(id) &&
    !covered.has(id) &&
    !underWildcard(id) &&
    !/\.\d+(\.|$)/.test(id),
);
const stale = [...declared].filter((id) => {
  if (captured.has(id)) return false;
  if (declaredWildcards.has(id)) return false;
  // a node that only groups children legitimately has no element of its own
  return ![...declared, ...captured].some((o) => o.startsWith(`${id}.`));
});

console.log(`capture:  ${DIR}`);
console.log(`found:    ${captured.size} testIDs`);
console.log(`declared: ${declared.size} paths in test/pageobjects/\n`);

if (added.length) {
  console.log(`--- ${added.length} in the app but NOT declared (add these) ---`);
  added.forEach((id) => console.log("  +", id));
} else {
  console.log("--- nothing new in the app ---");
}

if (stale.length) {
  console.log(`\n--- ${stale.length} declared but NOT in the capture ---`);
  console.log("    (renamed/removed upstream, or just not on a captured screen)");
  stale.forEach((id) => console.log("  -", id));
}

console.log("\n--- paste-ready skeleton, grouped by prefix ---");
console.log("// A child is resolved INSIDE its parent, so check the real tree before");
console.log("// nesting: a group below is only a component if it genuinely CONTAINS");
console.log("// its members. Where the app puts them side by side, declare them flat.");
console.log(skeleton());
