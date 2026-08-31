import { browser } from "@wdio/globals";
import type { IdPattern } from "../test/pageobjects/abstraction/component";

/**
 * One read of the whole tree, instead of one round-trip per element.
 *
 * Reading a large collection element-by-element cost ~396 round-trips for one pass
 * over a 98-row grid. XCUITest re-snapshots the entire element hierarchy
 * for every query, so cost grows with the size of the tree rather than with what you
 * asked for: locally those calls are ~50ms each and the whole read takes 20 seconds,
 * while on a hosted agent they are ~3s each and it takes 20 minutes. Same app, same
 * assertions - only the per-call latency differs. So fetch the tree ONCE and filter
 * locally, where it is free. See docs/architecture/performance.md.
 *
 * ⚠️ A READ-ONLY SHORTCUT THAT DOES NOT REPLACE THE PAGE OBJECTS. Specs still
 * address anything they click, type into or assert visibility on through
 * `ActionHelper`. This is for the narrow case of "tell me the id and text of every
 * member of a large collection".
 */

/** One element from the page source: its testID, and the text it displays. */
export interface SourceNode {
  /** iOS `name`, Android `resource-id` - i.e. the app's testID either way. */
  id: string;
  /** iOS `label`/`value`, Android `text`/`content-desc`. "" when it shows none. */
  text: string;
}

const ATTR = /([\w:-]+)="([^"]*)"/g;

/**
 * Every element in the current page source that carries a testID.
 *
 * ⚠️ Android's page source contains only what is currently LAID OUT, exactly as
 * it does for a selector - this changes how MANY round-trips a read costs, not
 * what the driver can see. A caller that walks the screen to union several
 * screenfuls still has to walk it.
 */
export async function readSource(): Promise<SourceNode[]> {
  return (await parseSource()).nodes;
}

/** A text-bearing node, attributed to the nearest ANCESTOR that carries a testID. */
interface OwnedText {
  /** The nearest enclosing testID, or "" when nothing above it has one. */
  ownerId: string;
  text: string;
}

interface ParsedSource {
  /** Every element carrying a testID - what `readSource` exposes. */
  nodes: SourceNode[];
  /**
   * Every element that SHOWS TEXT, tagged or not, attributed to its nearest
   * id-bearing ancestor.
   *
   * ⚠️ This is what makes a MISS authoritative. Without it, "the source does not
   * mention this text" could always mean "the text is on an untagged child I cannot
   * see", so every miss had to fall back to the per-member walk. See
   * findMemberByText.
   */
  owned: OwnedText[];
}

/**
 * ONE page source, parsed with enough structure to attribute text to a parent.
 *
 * The tag scan tracks a stack of id owners: an element's owner is its own testID
 * when it has one, and its parent's otherwise. Self-closing tags (`<XCUIElement…
 * />`) never push, closing tags pop. That is all the hierarchy this needs - it is
 * not a general XML parser and does not try to be.
 */
async function parseSource(): Promise<ParsedSource> {
  const xml = await browser.getPageSource();
  const nodes: SourceNode[] = [];
  const owned: OwnedText[] = [];
  // Every open tag pushes its owner; "" means nothing above carries a testID.
  const owners: string[] = [""];

  // Element tags only, open OR close: `[^!?]` skips the XML declaration and
  // comments. The lazy body stops at the first `>`, which is safe because both
  // drivers XML-escape attribute values (a literal `>` arrives as `&gt;`).
  for (const tag of xml.match(/<\/?[^!?][^>]*>/g) ?? []) {
    if (tag.startsWith("</")) {
      if (owners.length > 1) owners.pop();
      continue;
    }

    const attrs: Record<string, string> = {};
    for (const [, key, value] of tag.matchAll(ATTR)) attrs[key] = value;

    // WHICH ATTRIBUTE HOLDS THE ID DEPENDS ON HOW THE APP TAGS ITSELF, and React
    // Native gives teams two ways that land in different places on Android:
    //
    //   testID              -> iOS accessibilityIdentifier (`name`)
    //                          Android `resource-id`, unprefixed
    //   accessibilityLabel  -> iOS accessibilityLabel (`name` falls back to it)
    //                          Android `content-desc`
    //
    // Apps use one, the other, or both, so all three are read here - in that
    // order, most specific first. This MUST agree with byTestId() in
    // component.ts, or the page-source fast path and the selector it stands in
    // for would return different answers.
    const id = attrs.name || attrs["resource-id"] || attrs["content-desc"] || "";

    // iOS folds a row's descendant text into `label`; `value` carries a field's
    // contents. Android puts visible text on `text`.
    //
    // ⚠️ `content-desc` is a text source ONLY when it is not already serving as
    // the id. In an accessibilityLabel-tagged app every container would
    // otherwise report its own id as its visible text, and every oracle that
    // compares "text on screen" against "text a test can address" would go off
    // on all of it.
    const descIsId = !attrs.name && !attrs["resource-id"] && !!attrs["content-desc"];
    const text = unescapeXml(
      attrs.label || attrs.value || attrs.text ||
      (descIsId ? "" : attrs["content-desc"]) || "",
    );

    if (id) nodes.push({ id, text });
    const owner = id || owners[owners.length - 1];
    if (text) owned.push({ ownerId: owner, text });

    // A self-closing element has no children, so it never becomes an owner.
    if (!tag.endsWith("/>")) owners.push(owner);
  }
  return { nodes, owned };
}

/**
 * The rows of a keyed list, read in ONE round-trip.
 *
 * Mirrors what `rowField(prefix, tail)` matches - `<prefix>.<recordId><tail>` -
 * and returns recordId -> text so a caller can assert on membership, on counts,
 * or on per-row correlation without a lookup per row.
 *
 * ⚠️ Returns a Map keyed by the row's own runtime id, NOT a bare list of texts.
 * Two rows can legitimately display the same string (two rows both reading
 * "£500.00"), and a `Set<string>` of texts silently collapses them - which is its
 * own class of wrong answer.
 */
export async function rowFieldTexts(prefix: string, tail: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const from = `${prefix}.`;
  for (const { id, text } of await readSource()) {
    if (!id.startsWith(from) || !id.endsWith(tail)) continue;
    const recordId = id.slice(from.length, id.length - tail.length);
    // A row id has no dots of its own; anything else is a deeper descendant that
    // happens to share the ending (the same reason byRecordId excludes them).
    if (recordId && !recordId.includes(".")) out.set(recordId, text);
  }
  return out;
}

/**
 * The row ids of a keyed list, in ONE round-trip - `<prefix>.<recordId>` exactly,
 * with no trailing field. The page-source equivalent of `byRecordId(prefix)`.
 */
export async function rowIds(prefix: string): Promise<Set<string>> {
  const out = new Set<string>();
  const from = `${prefix}.`;
  for (const { id } of await readSource()) {
    if (!id.startsWith(from)) continue;
    const recordId = id.slice(from.length);
    if (recordId && !recordId.includes(".")) out.add(recordId);
  }
  return out;
}

/**
 * Everything an `IdPattern` matches, in document order, from ONE page source.
 *
 * ⚠️ It IGNORES THE PARENT SCOPE, which the XPath route applies. That is safe only
 * because both patterns pin a FULL id prefix, and a full prefix is normally unique
 * on a screen - `orders.item` and `orders.archived.item` are different strips. ⚠️ IF
 * YOUR APP REUSES ONE PREFIX UNDER TWO PARENTS AT ONCE, that collection must use the
 * per-element route; the fallback in `getTexts` is always correct.
 *
 * The upside beyond speed: a collection whose CONTAINER is missing from Android's
 * page source throws on the XPath route while its own children sit in the tree -
 * which reads as "the app didn't draw it" and is one of the four framework
 * artefacts rule 13 names. Reading the source has no container to miss.
 */
export async function matchPattern(pattern: IdPattern): Promise<SourceNode[]> {
  return (await readSource()).filter((node) => matchesPattern(pattern, node.id));
}

/**
 * Does `id` match `pattern` - by the SAME rules as the selector's XPath?
 *
 *   "rowField"  starts-with(`<prefix>.`) and ends-with(tail). ⚠️ NO no-dot rule on
 *               the middle, because `rowField`'s XPath has none either - so a deeper
 *               descendant sharing the tail is matched by both routes. Tidying it
 *               here would make a test's answer depend on which route read it.
 *   "row"       starts-with(`<prefix>.`) and the remainder holds no further dot,
 *               exactly as byRecordId's `not(contains(substring-after(...)))` half.
 *   "exact"     one of the listed ids, i.e. byTestId's `@name="a" or ...`.
 */
function matchesPattern(pattern: IdPattern, id: string): boolean {
  if (pattern.kind === "exact") return pattern.ids.includes(id);

  const from = `${pattern.prefix}.`;
  if (!id.startsWith(from)) return false;
  return pattern.kind === "rowField"
    ? id.endsWith(pattern.tail)
    : !id.slice(from.length).includes(".");
}

/**
 * WHICH member of a keyed collection shows `text` - answered in ONE round-trip.
 *
 * The per-member walk this replaces was the largest single cost this framework had:
 * a `getText()` on each member, then a `$$` for its descendants plus a `getText()`
 * on every one of THOSE when it did not match. Over a 98-row grid that was
 * 2,192 driver calls for one assertion.
 *
 * ⚠️ RETURNING A COUNT ALONGSIDE THE ID IS THE POINT: it makes a MISS authoritative.
 * An earlier version answered only for TAGGED text and returned undefined otherwise,
 * so every miss fell back to the walk - making the fast path help the case that was
 * already cheap and do nothing for the expensive one. And a WAITING LOOP is nothing
 * but misses: one poll-for-a-message test spent 84,865 driver calls that way, the
 * worst count ever recorded here, caused by the optimisation meant to prevent it.
 *
 * `parseSource` therefore attributes UNTAGGED text to its nearest id-bearing ancestor
 * too, so "the members are here and none of them shows this" is a fact rather than a
 * maybe. The caller falls back only when `members` is 0 - the container is not in the
 * tree at all, which on Android genuinely means the source cannot answer.
 *
 * Member order is document order, the same order `$$` returns, so "the first member
 * containing this text" means the same thing on both paths.
 */
export async function findMemberByText(
  pattern: IdPattern,
  text: string,
): Promise<{ id?: string; members: number }> {
  // ONE read for the members, their tagged descendants AND their untagged ones.
  const { nodes, owned } = await parseSource();
  const members = nodes.filter((node) => matchesPattern(pattern, node.id));

  for (const member of members) {
    if (member.text.includes(text)) return { id: member.id, members: members.length };

    // Anything inside this member that shows the text: a TAGGED descendant owns
    // itself, so its ownerId starts with the member's id and a dot; an UNTAGGED
    // one is attributed to the member directly.
    const inside = `${member.id}.`;
    const holds = owned.some(
      (node) =>
        (node.ownerId === member.id || node.ownerId.startsWith(inside)) &&
        node.text.includes(text),
    );
    if (holds) return { id: member.id, members: members.length };
  }
  return { members: members.length };
}

/** The five XML entities the drivers escape attribute values with. */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
