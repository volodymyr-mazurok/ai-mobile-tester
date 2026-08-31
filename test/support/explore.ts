/**
 * THE EXPLORATORY HARNESS - drive the app looking for what the suites do not check.
 *
 * What this is for
 * The specs in `test/specs/` are a regression: they assert what is KNOWN, against
 * a fixture that set it up. That is the right shape for a regression signal, and
 * it is structurally incapable of finding anything nobody thought to assert.
 * `COVERAGE.md`'s "Does not cover" lists are that blind spot written down.
 *
 * A charter under `test/exploratory/` is the other half. It DRIVES the app and
 * RECORDS what it sees, and it deliberately does not assert:
 *
 *   - a charter that fails tells you the charter broke, not that the app did;
 *   - a charter that passes tells you nothing at all.
 *
 * So a charter's output is EVIDENCE (a page source, a screenshot, an id
 * inventory, a before/after delta), which a person or the `explore-app` skill
 * then triages into a finding, a test, or nothing. Green and red are not the
 * vocabulary here.
 *
 * ⚠️ NOTHING IN HERE ASSERTS, AND NOTHING IN HERE THROWS ON A MISS. Every probe
 * catches. A charter that dies halfway through has thrown away everything it had
 * seen up to that point, which is the one failure mode that actually costs a
 * session - so `note()`/`observe()` write through to disk as they go, and a
 * charter is expected to wrap its own steps in `step()`.
 *
 * Why it has its own parse
 * `utils/pageSource.ts` parses the same XML and is deliberately narrow: id and
 * text, because that is all a fast collection read needs. Exploration wants what
 * that throws away - geometry, element type, enabled/visible, and the ancestry
 * that says which text has no addressable owner. So this parses independently
 * rather than widening a load-bearing production path for a diagnostic's sake.
 */
import * as fs from "fs";
import * as path from "path";
import { browser, driver } from "@wdio/globals";
import { APP } from "../../config/app";
import { repeatedPhrase } from "../../utils/copy";

/** Where a session's evidence lands. Gitignored. */
const ROOT = "./.explore";

/** One element of the live tree, with everything exploration needs to judge it. */
export interface ExploreNode {
  /** iOS `name`, Android `resource-id` - the app's testID either way. "" when untagged. */
  id: string;
  /** iOS `label`/`value`, Android `text`/`content-desc`. "" when it shows none. */
  text: string;
  /** `XCUIElementTypeButton`, `android.widget.TextView`, … */
  type: string;
  /**
   * Who this node's text and geometry BELONG to: its own id when it has one, else
   * the nearest ancestor's. "" when neither.
   *
   * ⚠️ NOT THE PARENT - and this JSDoc once said "the nearest ANCESTOR carrying a
   * testID", which is only true for an UNTAGGED node. For a tagged one this is the
   * node's own id, so `ownerId === someExpectedParent` can never be true and an
   * ancestry check written against it reports everything as flat. That cost a full
   * wrong answer about an app's nesting. Use `parentId`.
   *
   * The self-inclusive behaviour is deliberate and load-bearing - it is what lets the
   * text and geometry oracles below attribute a stray label to the element that owns
   * it, and utils/pageSource.ts relies on the same shape. Don't "fix" it.
   */
  ownerId: string;
  /**
   * The nearest ANCESTOR carrying a testID, never this node itself - "" at the top.
   *
   * This is the ancestry probe. For "is B really inside A?", walk `parentId` up from
   * B: a tagged node between them means B's immediate `parentId` is that node rather
   * than A, so compare against the whole CHAIN, not one hop.
   */
  parentId: string;
  enabled: boolean;
  /** What the driver CLAIMS. ⚠️ `*.screen` nodes and sheet overlays lie - see app-quirks.md. */
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Nesting depth, so a dump reads like a tree. */
  depth: number;
}

/** One captured screen: the tree, plus the files written for it. */
export interface Snapshot {
  label: string;
  nodes: ExploreNode[];
  /** Every distinct testID present, sorted - the cheap thing to diff. */
  ids: string[];
  xml: string;
  files: { xml: string; png: string; ids: string };
}

/** A candidate finding. NOT yet a bug - triage decides that. */
export interface Observation {
  /** `placeholder-text`, `dead-control`, `duplicate-id`, … - see SMELLS below. */
  kind: string;
  /** What was seen, in one line, concrete enough to grep the known findings with. */
  note: string;
  /** Where: a testID, an alias path, a screen name. */
  where?: string;
  /** Anything that proves it - a text value, a count, a delta. */
  evidence?: string;
  /** Filled in by triage: an APP_ISSUES / TESTID_IMPROVEMENTS id, or "new". */
  dedupe?: string;
}

const ATTR = /([\w:-]+)="([^"]*)"/g;

/**
 * Is this the app's own testID, or just an iOS label wearing one's clothes?
 *
 * ⚠️ THE QUESTION ONLY EXISTS ON iOS. There, `@name` FALLS BACK TO THE VISIBLE
 * LABEL when an element has no accessibilityIdentifier, so every untagged text
 * node arrives looking like a tagged one - which once had the duplicate-id oracle
 * report two ordinary field LABELS and a 900-character concatenation of a whole
 * screen as duplicated ids. Noise, and enough to bury a real finding.
 *
 * On ANDROID both `resource-id` and `content-desc` are explicit and never fall
 * back to text, so every non-empty id is genuine and nothing is filtered. Doing
 * otherwise cost a whole sweep: an app tagged with accessibilityLabel reported
 * `0 testIDs` on every screen, which turned every text node into an
 * `untagged-text` finding and made a working sort control look dead.
 *
 * The iOS pattern is per-app - see `iosTestIdPattern` in config/app.ts.
 */
export const looksLikeTestId = (id: string): boolean => {
  if (!id) return false;
  if (!browser.isIOS) return true;
  return (APP.iosTestIdPattern ?? /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9<>]+)+$/).test(id);
};

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Parse a page source into nodes, tracking the id-bearing ancestor of each.
 *
 * Same tag-stack trick `pageSource.ts` uses, widened: it also carries geometry
 * and type, and it keeps UNTAGGED nodes (which that one drops) because "this
 * text belongs to nothing addressable" is one of the findings worth having.
 *
 * ⚠️ Android's bounds are `[x,y][x2,y2]`; iOS has x/y/width/height attributes.
 * Both are normalised to x/y/width/height here.
 */
export function parseTree(xml: string): ExploreNode[] {
  const nodes: ExploreNode[] = [];
  const owners: string[] = [""];

  for (const tag of xml.match(/<\/?[^!?][^>]*>/g) ?? []) {
    if (tag.startsWith("</")) {
      if (owners.length > 1) owners.pop();
      continue;
    }

    const attrs: Record<string, string> = {};
    for (const [, key, value] of tag.matchAll(ATTR)) attrs[key] = value;

    // Three attributes, most specific first - React Native's `testID` lands on
    // `resource-id`, its `accessibilityLabel` on `content-desc`, and apps use
    // either. ⚠️ Keep in step with utils/pageSource.ts and byTestId().
    const id = attrs.name || attrs["resource-id"] || attrs["content-desc"] || "";
    // `content-desc` is a TEXT source only when it is not already the id -
    // otherwise every tagged container reports its own id as visible text.
    const descIsId = !attrs.name && !attrs["resource-id"] && !!attrs["content-desc"];
    const text = unescapeXml(
      attrs.label || attrs.value || attrs.text ||
      (descIsId ? "" : attrs["content-desc"]) || "",
    );

    let { x, y, width, height } = {
      x: num(attrs.x),
      y: num(attrs.y),
      width: num(attrs.width),
      height: num(attrs.height),
    };
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds ?? "");
    if (bounds) {
      x = Number(bounds[1]);
      y = Number(bounds[2]);
      width = Number(bounds[3]) - x;
      height = Number(bounds[4]) - y;
    }

    nodes.push({
      id,
      text,
      type: /<\/?([\w.]+)/.exec(tag)?.[1] ?? "",
      ownerId: id || owners[owners.length - 1],
      // The stack still holds only ANCESTORS at this point - self is pushed below,
      // after the node is built - so this is the enclosing tagged element.
      parentId: owners[owners.length - 1],
      enabled: attrs.enabled !== "false",
      visible: attrs.visible !== "false",
      x,
      y,
      width,
      height,
      depth: owners.length - 1,
    });

    if (!tag.endsWith("/>")) owners.push(id || owners[owners.length - 1]);
  }
  return nodes;
}

/**
 * A session: one charter, one output directory, notes written as they happen.
 *
 * Create it with `startSession()`, and treat everything it returns as
 * best-effort - a session must survive anything the app does to it.
 */
export class ExploreSession {
  public readonly dir: string;
  public readonly platform: string;
  private readonly observations: Observation[] = [];
  private readonly lines: string[] = [];
  private counter = 0;

  constructor(public readonly charter: string) {
    this.platform = String(
      (driver.capabilities as Record<string, unknown>).platformName ?? "unknown",
    ).toLowerCase();
    // No timestamp in the path: a charter re-run should OVERWRITE its evidence
    // rather than leave a dozen near-identical directories to pick between.
    // Keep an old one by hand if a comparison matters.
    this.dir = path.join(ROOT, `${this.charter}-${this.platform}`);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.note(`# Charter: ${this.charter}`);
    this.note(`platform: ${this.platform}`);
  }

  /** A line in the session log. Written through immediately. */
  public note(line: string): void {
    this.lines.push(line);
    fs.writeFileSync(path.join(this.dir, "notes.md"), this.lines.join("\n") + "\n");
    console.log(`[explore] ${line}`);
  }

  /** Record a candidate finding. Written through immediately. */
  public observe(o: Observation): void {
    this.observations.push(o);
    fs.writeFileSync(
      path.join(this.dir, "observations.json"),
      JSON.stringify(this.observations, null, 2),
    );
    this.note(`- **${o.kind}** ${o.where ? `\`${o.where}\` ` : ""}- ${o.note}${o.evidence ? ` — ${o.evidence}` : ""}`);
  }

  /**
   * Run one step of the charter, swallowing whatever it throws.
   *
   * ⚠️ A charter must never die on a miss. Half a session's evidence is worth
   * having; a stack trace instead of it is not. What the step threw is itself
   * recorded - a step that cannot even be driven is frequently the finding.
   */
  public async step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    this.note(`\n## ${label}`);
    try {
      return await fn();
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      this.note(`⚠️ step threw: ${message.split("\n")[0]}`);
      this.observe({
        kind: "step-failed",
        where: label,
        note: "the charter could not complete this step",
        evidence: message.split("\n")[0],
      });
      return undefined;
    }
  }

  /** Capture the screen: tree, screenshot, id inventory. */
  public async snapshot(label: string): Promise<Snapshot> {
    const name = `${String(++this.counter).padStart(2, "0")}-${label.replace(/[^\w-]+/g, "_")}`;
    const xml = await browser.getPageSource();
    const nodes = parseTree(xml);
    // Real testIDs only - see looksLikeTestId. A snapshot's `nodes` keep
    // everything, because the text and geometry oracles want untagged elements.
    const ids = [...new Set(nodes.map((n) => n.id).filter(looksLikeTestId))].sort();

    const files = {
      xml: path.join(this.dir, `${name}.xml`),
      png: path.join(this.dir, `${name}.png`),
      ids: path.join(this.dir, `${name}.ids.txt`),
    };
    fs.writeFileSync(files.xml, xml);
    fs.writeFileSync(files.ids, ids.join("\n"));
    try {
      fs.writeFileSync(files.png, Buffer.from(await browser.takeScreenshot(), "base64"));
    } catch {
      /* a screenshot is nice to have, never worth losing the tree for */
    }

    this.note(`snapshot \`${name}\` - ${nodes.length} nodes, ${ids.length} testIDs`);
    return { label, nodes, ids, xml, files };
  }

  /** Everything recorded so far. */
  public findings(): Observation[] {
    return this.observations;
  }

  /** Close the session and print a digest the skill can act on. */
  public finish(): void {
    const byKind = new Map<string, number>();
    for (const o of this.observations) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
    this.note(
      `\n## Session end - ${this.observations.length} observations` +
        (byKind.size
          ? `\n\n${[...byKind].map(([k, n]) => `- ${k}: ${n}`).join("\n")}`
          : "\n\nNothing flagged."),
    );
    console.log(`\n[explore] evidence in ${this.dir}\n`);
  }
}

export function startSession(charter: string): ExploreSession {
  return new ExploreSession(charter);
}

/* ============================ THE ORACLES ============================
 * A heuristic here earns its place by having caught something real once. Each
 * one is deliberately NOISY-BUT-CHEAP: it costs no extra driver round-trip
 * (everything works off a snapshot already taken), and a false positive costs a
 * triage step, while a missed class of bug costs a release.
 *
 * ⚠️ AN OBSERVATION IS NOT A FINDING. Several of these will fire on things already
 * written down and already decided about - a stray space inside a currency figure,
 * two different dash characters, screen roots reporting themselves invisible. That
 * is expected, and is why triage is a separate step with `npm run explore:index --
 * search <term>` behind it. Do not silence a heuristic to stop a known finding
 * reappearing; dedupe it at triage, where the decision is recorded.
  */

/** Values that should never reach a user's screen. */
const LEAKED = /\b(undefined|NaN|null|Infinity|\[object Object\]|__DEV__|TODO|FIXME)\b|\{\{|%[sd]\b/;

/**
 * Everything the tree alone can tell you, with no further round-trips.
 *
 * Returns observations; the caller decides which to record. Split out from the
 * session so a charter can run it over a snapshot it took for other reasons.
 */
export function smells(snap: Snapshot, window?: { width: number; height: number }): Observation[] {
  const out: Observation[] = [];
  const tagged = snap.nodes.filter((n) => looksLikeTestId(n.id));

  // 1. A value the app meant to compute and did not. The single highest-signal
  //    check there is: "£NaN" and "undefined" are never intentional.
  for (const n of snap.nodes) {
    if (n.text && LEAKED.test(n.text))
      out.push({
        kind: "placeholder-text",
        where: n.ownerId || n.type,
        note: "a value that looks unrendered reached the screen",
        evidence: JSON.stringify(n.text.slice(0, 120)),
      });
  }

  // 2. A word or phrase repeated back-to-back in user-facing copy. Cheap, and it
  //    finds a class of defect no functional assertion ever will - the app works
  //    perfectly, it just says "Are you sure you sure you want to logout?".
  //
  //    ⚠️ PHRASES, not adjacent identical words. A word-versus-next-word check
  //    misses exactly the example above, because no two neighbouring words there
  //    are equal. See utils/copy.ts - a spec once passed green on that mistake.
  for (const n of snap.nodes) {
    if (!n.text || n.text.length < 8) continue;
    const phrase = repeatedPhrase(n.text);
    if (phrase)
      out.push({
        kind: "repeated-phrase",
        where: n.ownerId || n.type,
        note: `user-facing copy repeats "${phrase}" back-to-back`,
        evidence: JSON.stringify(n.text.slice(0, 120)),
      });
  }

  // 3. Two elements answering to one testID. Every selector in this framework is
  //    an exact id match, so a duplicate makes the second one unaddressable AND
  //    makes the first one's assertions ambiguous - a real testability finding,
  //    and one a person never sees by looking at the screen.
  const seen = new Map<string, number>();
  for (const n of tagged) seen.set(n.id, (seen.get(n.id) ?? 0) + 1);
  for (const [id, count] of seen)
    if (count > 1)
      out.push({
        kind: "duplicate-id",
        where: id,
        note: "one testID matches more than one element on this screen",
        evidence: `${count} matches`,
      });

  // 4. Text belonging to nothing addressable. This is what "the app renders it
  //    and no test can ever check it" looks like in the tree.
  for (const n of snap.nodes)
    if (n.text && !looksLikeTestId(n.ownerId) && n.width > 0 && n.height > 0)
      out.push({
        kind: "untagged-text",
        where: n.type,
        note: "visible text with no id-bearing ancestor - unaddressable",
        evidence: JSON.stringify(n.text.slice(0, 80)),
      });

  // 5. A control with no accessible name. Fails a screen reader as well as a
  //    test - the accessibility half of this is the part worth reporting.
  for (const n of snap.nodes)
    if (/Button|Switch|Checkbox|ImageButton/i.test(n.type) && !n.text && !n.id && n.width > 0)
      out.push({
        kind: "unlabelled-control",
        where: `${n.type} @ ${n.x},${n.y}`,
        note: "an interactive element with neither a testID nor an accessible label",
      });

  // 6. Currency formatting. Most apps render an unspaced symbol - and a real
  //    offender used an EN SPACE, which is invisible in a screenshot and survives
  //    review. Flag ANY whitespace after the sign and any mixed use of decimals,
  //    then let triage sort known from new.
  const money = snap.nodes.filter((n) => /[£$€]/.test(n.text));
  for (const n of money)
    if (/[£$€][\s  -​]/.test(n.text))
      out.push({
        kind: "currency-format",
        where: n.ownerId,
        note: "whitespace between the currency sign and the figure",
        evidence: `${JSON.stringify(n.text)} (codepoints ${[...n.text].slice(0, 4).map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase()).join(" ")})`,
      });
  const withPence = money.filter((n) => /[£$€][\d,]+\.\d\d/.test(n.text)).length;
  const withoutPence = money.filter((n) => /[£$€][\d,]+(?!\.)\b/.test(n.text)).length;
  if (withPence && withoutPence)
    out.push({
      kind: "currency-format",
      where: snap.label,
      note: "the same screen shows currency both with and without pence",
      evidence: `${withPence} with, ${withoutPence} without`,
    });

  // 7. Two different characters meaning "no value" on one screen - a hyphen in one
  //    row and an en dash in the next. Cosmetic-looking, and it defeats any
  //    assertion written against either.
  const dashes = new Set(
    snap.nodes.flatMap((n) => (/^[\s]*[-–—]{1,2}[\s]*$/.test(n.text) ? [n.text.trim()] : [])),
  );
  if (dashes.size > 1)
    out.push({
      kind: "inconsistent-placeholder",
      where: snap.label,
      note: "more than one dash character used to mean 'no value'",
      evidence: [...dashes].map((d) => `${JSON.stringify(d)} U+${d.codePointAt(0)!.toString(16).toUpperCase()}`).join(", "),
    });

  // 8. Truncated text. Not automatically a bug - it is a bug when the truncated
  //    thing is the only copy of the information (a name, an amount).
  for (const n of tagged)
    if (/[…]$|\.\.\.$/.test(n.text.trim()))
      out.push({
        kind: "truncated-text",
        where: n.id,
        note: "text is elided on screen",
        evidence: JSON.stringify(n.text.slice(0, 80)),
      });

  // 9. A tagged element with size zero. The app's own wrapper views do this all
  //    over (`*.screen`), so it is only interesting when the element CARRIES
  //    text - i.e. something is rendered that cannot be seen or tapped.
  for (const n of tagged)
    if (n.text && (n.width === 0 || n.height === 0))
      out.push({
        kind: "zero-size-content",
        where: n.id,
        note: "an element with text has zero width or height",
        evidence: `${n.width}x${n.height}`,
      });

  // 10. Content laid out off the window. On iOS the tree keeps off-screen scroll
  //    content, so this is expected inside a scroll view and NOT expected for
  //    something at a negative coordinate or past the right edge - which is what
  //    a clipped-off control looks like (a header sitting under the status bar,
  //    for instance).
  if (window)
    for (const n of tagged)
      if (n.width > 0 && (n.x < 0 || n.x + n.width > window.width + 1))
        out.push({
          kind: "clipped-horizontally",
          where: n.id,
          note: "laid out beyond the left or right edge of the window",
          evidence: `x=${n.x} w=${n.width} window=${window.width}`,
        });

  return out;
}

/** What changed between two snapshots - the core exploratory oracle. */
export interface Delta {
  appeared: string[];
  disappeared: string[];
  /** ids whose text changed: id -> [before, after] */
  changed: Array<[string, string, string]>;
  /** True when nothing at all moved. */
  inert: boolean;
}

export function delta(before: Snapshot, after: Snapshot): Delta {
  const b = new Set(before.ids);
  const a = new Set(after.ids);
  const textOf = (s: Snapshot): Map<string, string> => {
    const m = new Map<string, string>();
    for (const n of s.nodes) if (n.id && n.text && !m.has(n.id)) m.set(n.id, n.text);
    return m;
  };
  const bt = textOf(before);
  const at = textOf(after);
  const changed: Array<[string, string, string]> = [];
  for (const [id, text] of at) {
    const was = bt.get(id);
    if (was !== undefined && was !== text) changed.push([id, was, text]);
  }
  const appeared = [...a].filter((id) => !b.has(id));
  const disappeared = [...b].filter((id) => !a.has(id));
  return {
    appeared,
    disappeared,
    changed,
    inert: !appeared.length && !disappeared.length && !changed.length,
  };
}

/**
 * Do something, and record what the app did about it.
 *
 * ⚠️ THE POINT IS THE `inert` CASE. "I tapped it and the tree is byte-identical"
 * is the signature of the two most expensive findings the predecessor project ever
 * filed - a confirmation message that was never shown, and a Save button that did
 * nothing on one emulator. Both were found by a person noticing that nothing
 * happened; this makes it a recorded fact instead of a hunch.
 *
 * The settle is a fixed pause on purpose - there is nothing to poll for when the
 * question is "does ANYTHING happen?", and a wait-for-something would beg it.
 */
export async function probe(
  session: ExploreSession,
  label: string,
  action: () => Promise<unknown>,
  settleMs = 2500,
): Promise<Delta | undefined> {
  const before = await session.snapshot(`${label}-before`);
  try {
    await action();
  } catch (e) {
    session.observe({
      kind: "step-failed",
      where: label,
      note: "the action itself could not be performed",
      evidence: ((e as Error)?.message ?? String(e)).split("\n")[0],
    });
    return undefined;
  }
  await browser.pause(settleMs);
  const after = await session.snapshot(`${label}-after`);
  const d = delta(before, after);

  if (d.inert)
    session.observe({
      kind: "dead-control",
      where: label,
      note: "the accessibility tree is unchanged after this interaction",
      evidence: `settled ${settleMs}ms, ${after.ids.length} ids both sides`,
    });
  else
    session.note(
      `  +${d.appeared.length} / -${d.disappeared.length} ids, ${d.changed.length} texts changed` +
        (d.appeared.length ? `\n  appeared: ${d.appeared.slice(0, 15).join(", ")}` : "") +
        (d.disappeared.length ? `\n  gone: ${d.disappeared.slice(0, 15).join(", ")}` : ""),
    );
  return d;
}

/**
 * Every id on screen, grouped by prefix, as a paste-ready inventory.
 *
 * Row ids are collapsed (`…item.4711` -> `…item.<id>`) so two runs against
 * different data produce comparable output - which is what makes an inventory
 * diffable against the committed page objects.
 */
export function inventory(snap: Snapshot): string {
  const collapsed = [
    ...new Set(
      snap.ids.map((id) => id.replace(/\.\d{2,}(?=\.|$)/g, ".<id>").replace(/\.\d+(?=\.)/g, ".<n>")),
    ),
  ].sort();
  const groups = new Map<string, string[]>();
  for (const id of collapsed) {
    const prefix = id.split(".").slice(0, 2).join(".");
    groups.set(prefix, [...(groups.get(prefix) ?? []), id]);
  }
  return [...groups]
    .map(([prefix, ids]) => `${prefix} (${ids.length})\n${ids.map((i) => `  ${i}`).join("\n")}`)
    .join("\n\n");
}
