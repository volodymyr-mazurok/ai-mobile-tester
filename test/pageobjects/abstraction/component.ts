import { $, $$, browser } from "@wdio/globals";
// Value import, and safe: pageSource.ts imports only the IdPattern TYPE from this
// file, which is erased at compile time - so there is no runtime cycle.
import { findMemberByText } from "../../../utils/pageSource";

// ONE entity. A page, a section, a collection and a leaf are all Components -
// the only differences are whether it has a selector and whether it has
// children, and both of those are just "is this field set".
//
//   a page       no selector (it IS the document root), has children
//   a section    a selector, has children
//   a collection a selector that matches many, usually has children
//   a leaf       a selector, no children
//
// THE ONE RULE
// ------------
// A child is always looked up INSIDE its parent's element. So the tree declared
// in a page object has to mirror the real accessibility tree: whatever you nest
// something under must genuinely contain it.
//
// You do not have to declare every intermediate node - "inside" means
// descendant, at any depth - but you may not declare a SIBLING as a child. If
// the app puts two elements side by side, they belong side by side in the page
// object too (see page.ts's header for a real case of this).
//
// Every selector is XPath, on both platforms - see byTestId at the bottom for
// why. So every selector is relative (`.//...`) and nests the same way, and
// there is no second strategy whose scoping rules you have to remember.
//
// Path grammar, unchanged:
//
//   "Account Section > Email"          walk into a child
//   "#Weekly in Toggles"               the collection member containing text
//   "#2 of Toggles"                    the collection member at 1-based index
//   "#Weekly in Toggles > Box"         ...then into that member's children
//
// find() works from ANY component, not just the page - a component knows its
// parent, so it resolves its own ancestors first and searches inside itself:
//
//   Settings.find("Notifications Section > #Weekly in Toggles > Box")
//   Notifications.find("#Weekly in Toggles > Box")        // same element

/**
 * What a selector matches, expressed as an ID SHAPE rather than as XPath.
 *
 * Why a selector carries this as well as XPath
 *
 * Reading a collection's text the obvious way is one `findAll()` plus a `getText()`
 * PER MEMBER, and on iOS every one of those is a full re-snapshot of the element
 * hierarchy: ~50ms on a dev machine, ~3s on a hosted agent, so a 98-row collection
 * costs ~5 minutes per read. A selector that knows the ID SHAPE it matches can be answered
 * from ONE page source instead - see utils/pageSource.ts and ActionHelper.getTexts().
 * This is the metadata that makes that possible without a spec ever naming an id.
 *
 * Only the two row builders set it; everything else is undefined and callers
 * fall back to the per-element route, which is always correct.
 */
export type IdPattern =
  /** `<prefix>.<recordId><tail>` - a named field, across every row. */
  | { kind: "rowField"; prefix: string; tail: string }
  /** `<prefix>.<recordId>` exactly, with no field after it - the rows themselves. */
  | { kind: "row"; prefix: string }
  /**
   * Exactly these ids, in the order the tree holds them - what byTestId matches.
   *
   * ⚠️ A SMALL byTestId COLLECTION CAN BE THE MOST EXPENSIVE THING IN A SUITE,
   * which is why this pattern exists at all. Measured across a full local iOS
   * regression: the two dearest tests of 95 were on a FIVE-row toggle grid, at
   * 2645 and 2595 driver calls - more than any hundred-row list in the same run.
   * Every `#<text> in <collection>` lookup walks all five members plus each one's
   * descendants, and a test that then scrolls to a row BY TEXT re-runs that whole
   * walk between every swipe.
   *
   * It hides completely on a dev machine - that spec finished in 1m 18s - and it
   * is exactly the kind of test that then times out on a hosted agent.
   */
  | { kind: "exact"; ids: string[] };

/** iOS and Android locators for the same element. */
export interface PlatformSelector {
  ios: string;
  android: string;
  /**
   * The id shape `ios`/`android` encode, when it is expressible as one.
   *
   * ⚠️ MUST describe EXACTLY what the XPath matches, never something tidier.
   * The whole value of the fast path is that it returns the same answer as the
   * selector it stands in for, so a test's result cannot depend on which route
   * read it - see rowField() on why it does not apply byRecordId's no-dot rule.
   */
  idPattern?: IdPattern;
}

export interface ComponentInit {
  alias: string;
  /**
   * Omitted only by a page, which is the document root and matches nothing.
   *
   * A plain string is a TAIL - this element's own trailing segment, expanded
   * against its PARENT's prefix. Only defineComponent can resolve that (it is
   * the only place the parent is known), so the constructor rejects one.
   */
  selector?: PlatformSelector | string;
  /** True when the selector is expected to match many elements. */
  isCollection?: boolean;
  /**
   * The testID prefix this element's children hang off, so each child can name
   * just its own tail and still resolve to a FULL, exact id. See defineComponent.
   *
   * It has to be stated rather than derived from the selector, because the app
   * is not consistent about it: `settings.account.card` holds
   * `settings.account.emailValue` (prefix = the id minus its last segment)
   * while `settings.logoutButton` holds `settings.logoutButton.label` (prefix =
   * the whole id). Guessing between those would be a coin flip.
   */
  prefix?: string;
}

type Parsed = {
  alias: string;
  byText?: string;
  byIndex?: number;
};

/**
 * "#Weekly in Toggles" / "#2 of Toggles" / "Email"
 *
 * The value is matched GREEDILY so the split lands on the LAST " of "/" in ",
 * which is the one separating the value from the alias. Non-greedy split on the
 * first, and any row whose own text contains those words broke: caught live, a
 * row titled "Preferred Method of Contact" parsed as index "Preferred Method" of
 * a collection called "Contact in Rows".
 */
function parseUnit(unit: string): Parsed {
  const match = unit.match(/^#(.+)\s+(of|in)\s+(.+)$/);
  if (!match) return { alias: unit.trim() };

  const [, value, operator, alias] = match;
  if (operator === "of") {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 1)
      throw new Error(`"${unit}": "of" needs a 1-based index, got "${value}"`);
    return { alias: alias.trim(), byIndex: index };
  }
  return { alias: alias.trim(), byText: value.trim() };
}

export class Component {
  public readonly alias: string;
  public readonly selector?: PlatformSelector;
  public readonly isCollection: boolean;
  public readonly prefix?: string;

  private parent?: Component;
  private readonly children = new Map<string, Component>();

  constructor(init: ComponentInit) {
    if (!init.alias)
      throw new Error(`Alias of ${this.constructor.name} is not defined`);
    if (typeof init.selector === "string")
      throw new Error(
        `"${init.alias}" was given the tail "${init.selector}" directly. A tail ` +
          `is expanded against the PARENT's prefix, which only the parent knows ` +
          `- pass it to defineComponent instead of constructing with it.`,
      );
    if (init.selector && (!init.selector.ios || !init.selector.android))
      throw new Error(
        `${this.constructor.name} "${init.alias}" needs both an ios and an ` +
          `android selector`,
      );

    this.alias = init.alias;
    this.selector = init.selector;
    this.isCollection = init.isCollection ?? false;
    this.prefix = init.prefix;
  }

  // -- building the tree ----------------------------------------------------

  /**
   * Add a child, or REPLACE the one already under that alias. Redeclaring is
   * how a subclass specialises an inherited component - same alias, its own
   * selector - so the last declaration wins rather than erroring.
   */
  private attach(child: Component): this {
    if (child.parent && child.parent !== this)
      throw new Error(
        `"${child.alias}" is already a child of "${child.parent.alias}". ` +
          `Construct a new one per parent rather than sharing the instance.`,
      );
    child.parent = this;
    this.children.set(child.alias, child);
    return this;
  }

  /**
   * Declare a child. There is one entity, so there is one way to add one -
   * whether it turns out to be a leaf, a collection or a whole section is a
   * property of the thing, not a different method.
   *
   *   this.defineComponent({ alias: "Email", selector: "emailValue" });
   *   this.defineComponent({ alias: "Rows", selector: byRecordId("x.item"), isCollection: true });
   *   this.defineComponent(new AccountSection());
   *
   * Pass a BUILT component when it has children of its own or constructor
   * logic; pass an init object otherwise. Nothing requires a component to have
   * children - a childless one is just a leaf.
   *
   * `selector` is either
   *
   *   a TAIL      - this child's own trailing segment, expanded to a FULL
   *                 testID using THIS element's `prefix`. The normal case:
   *
   *                   super({ alias: "Account Section", prefix: "settings.account",
   *                           selector: byTestId("settings.account.card") });
   *                   this.defineComponent({ alias: "Email", selector: "emailValue" });
   *
   *                   -> //*[@name="settings.account.card"]
   *                      //*[@name="settings.account.emailValue"]
   *
   *                 The prefix is written once and the selector is still an
   *                 exact match on a complete id, so it reads the same in
   *                 Appium Inspector as it does here.
   *
   *   a SELECTOR  - for anything the prefix can't express: a different prefix,
   *                 a relative match inside a collection member, or a
   *                 hand-written locator for something the app doesn't tag.
   */
  protected defineComponent(child: Component | ComponentInit): this {
    if (child instanceof Component) return this.attach(child);
    return this.attach(
      new Component({ ...child, selector: this.asSelector(child.selector) }),
    );
  }

  private asSelector(
    selector: PlatformSelector | string | undefined,
  ): PlatformSelector | undefined {
    return typeof selector === "string" ? this.childIds(selector) : selector;
  }

  /**
   * The full ids of one or more children, for a selector this element builds
   * itself - a collection pinned to exactly the rows it owns, say.
   */
  protected childIds(...tails: string[]): PlatformSelector {
    if (!this.prefix)
      throw new Error(
        `"${this.alias}" has no prefix, so its children can't be named by ` +
          `their tail alone - give it one, or write the child's full testID.`,
      );
    return byTestId(...tails.map((tail) => `${this.prefix}.${tail}`));
  }

  // -- reading the tree -----------------------------------------------------

  public child(alias: string): Component {
    const found = this.children.get(alias);
    if (!found)
      throw new Error(
        `"${alias}" is not defined under "${this.alias}". ` +
          `Available: ${this.aliases.join(", ") || "(none)"}`,
      );
    return found;
  }

  /** Every child alias - for error messages and discovery. */
  public get aliases(): string[] {
    return [...this.children.keys()];
  }

  /** The locator for the platform the current session is running on. */
  public locator(isIOS: boolean): string {
    if (!this.selector)
      throw new Error(
        `"${this.alias}" has no selector - it is a root container, so it can ` +
          `only be searched inside, never matched itself`,
      );
    return isIOS ? this.selector.ios : this.selector.android;
  }

  // -- resolving against the live app ---------------------------------------

  /** Resolve a path to a single element, starting inside this component. */
  public async find(path: string): Promise<WebdriverIO.Element> {
    const units = this.split(path);
    let definition: Component = this;
    let element = await this.resolveSelf();

    for (const unit of units) {
      const parsed = parseUnit(unit);
      definition = definition.child(parsed.alias);
      element = await this.resolveOne(definition, parsed, element, path);
    }
    return element as WebdriverIO.Element;
  }

  /** Every element a collection path matches, starting inside this component. */
  public async findAll(path: string): Promise<WebdriverIO.Element[]> {
    const units = this.split(path);
    let definition: Component = this;
    let scope = await this.resolveSelf();

    for (const unit of units.slice(0, -1)) {
      const parsed = parseUnit(unit);
      definition = definition.child(parsed.alias);
      scope = await this.resolveOne(definition, parsed, scope, path);
    }

    const last = definition.child(parseUnit(units[units.length - 1]).alias);
    if (!last.isCollection)
      throw new Error(`"${last.alias}" is not a collection`);
    return this.matches(last, scope);
  }

  /**
   * What a path RESOLVES TO IN THE DECLARATION, with no device round-trip.
   *
   * The tree is static - a path names the same component whether or not anything
   * is on screen - so this is pure lookup, and it throws on an unknown alias with
   * the same message walking the path would. It exists so a read can ask "what id
   * shape does this collection match?" before deciding how to fetch it; see
   * `getTexts` in utils/actions.ts.
   *
   * `#N of` / `#text in` filters are parsed off and IGNORED here: they select
   * among a collection's members at runtime and say nothing about the
   * declaration. A caller that cares must check for them itself.
   */
  public definitionFor(path: string): Component {
    let definition: Component = this;
    for (const unit of this.split(path))
      definition = definition.child(parseUnit(unit).alias);
    return definition;
  }

  /** True when any unit of `path` filters by index or text. */
  public static isFiltered(path: string): boolean {
    return path
      .split(">")
      .map((unit) => unit.trim())
      .filter(Boolean)
      .some((unit) => parseUnit(unit).byIndex !== undefined || parseUnit(unit).byText !== undefined);
  }

  private split(path: string): string[] {
    const units = path.split(">").map((u) => u.trim()).filter(Boolean);
    if (!units.length) throw new Error("Empty element path");
    return units;
  }

  /**
   * This component's own element, with its ancestors resolved first. Null for a
   * page, which has no selector - its children search the whole screen.
   */
  private async resolveSelf(): Promise<WebdriverIO.Element | null> {
    if (!this.selector) return null;
    const above = this.parent ? await this.parent.resolveSelf() : null;
    return this.resolveOne(this, { alias: this.alias }, above, this.alias);
  }

  private async matches(
    definition: Component,
    scope: WebdriverIO.Element | null,
  ): Promise<WebdriverIO.Element[]> {
    const selector = definition.locator(browser.isIOS);
    const found = scope ? await scope.$$(selector) : await $$(selector);
    return found as unknown as WebdriverIO.Element[];
  }

  private async resolveOne(
    definition: Component,
    parsed: Parsed,
    scope: WebdriverIO.Element | null,
    path: string,
  ): Promise<WebdriverIO.Element> {
    const selector = definition.locator(browser.isIOS);

    // A plain element: one lookup, inside the parent when there is one.
    if (!definition.isCollection && parsed.byIndex === undefined && !parsed.byText) {
      const el = scope ? scope.$(selector) : $(selector);
      return el as unknown as WebdriverIO.Element;
    }

    if (!definition.isCollection)
      throw new Error(
        `"${definition.alias}" is not a collection, so "${
          parsed.byText ?? `#${parsed.byIndex}`
        }" cannot be used with it in path "${path}"`,
      );

    // One page source, not a getText() per member
    // ⚠️ Runs BEFORE the members are materialised, because the walk below is the
    // most expensive thing this framework does. It costs a round-trip per member,
    // plus a `$$` and a round-trip per DESCENDANT for every member that does not
    // match. Measured with wdio.conf.ts's `[cost]` counter over a 98-row grid,
    // two tests of the same suite cost 2192 and 1592 driver calls, nearly all of
    // it this one lookup. Fixing it took that whole suite from 29,595 calls to
    // 5,584 with all 17 tests still passing, and the local wall clock barely
    // moved (10m43s -> 10m18s).
    //
    // That gap is the point, and it is rule 9: locally the run is dominated by
    // animation settles, so the cost is invisible; on a hosted agent the calls
    // themselves ARE the cost, and these ate a 900s Mocha ceiling three times
    // over.
    //
    // So ask the page source WHICH member holds the text (one round-trip), then
    // address that member by its own exact id (one more). Falls through to the
    // walk when the source cannot answer - text on an UNTAGGED child, or a
    // collection whose selector carries no id pattern - so what `#text in`
    // matches is unchanged, only how it is found.
    if (parsed.byText && definition.selector?.idPattern) {
      const hit = await findMemberByText(definition.selector.idPattern, parsed.byText);
      if (hit.id) {
        const exact = byTestId(hit.id);
        const locator = browser.isIOS ? exact.ios : exact.android;
        const el = scope ? scope.$(locator) : $(locator);
        return el as unknown as WebdriverIO.Element;
      }
      // ⚠️ THE MEMBERS ARE HERE AND NONE OF THEM SHOWS IT - so say so, in one
      // round-trip, instead of walking them all to reach the same answer.
      //
      // This is the half the first version got wrong, and one CI run priced it:
      // a single test spent 84,865 driver calls waiting for a row to appear.
      // Every poll missed, fell through to the walk below, and paid for every
      // member and every descendant - so the fast path optimised hits, which were
      // already cheap, and left the MISSES that a waiting loop is made of exactly
      // as expensive as before.
      //
      // Only a source with NO members falls through now: on Android that means
      // the container is not laid out, and the source genuinely cannot answer.
      if (hit.members > 0)
        throw new Error(
          `No member of "${definition.alias}" (${hit.members} found) contains ` +
            `the text "${parsed.byText}"`,
        );
    }

    const members = await this.matches(definition, scope);

    if (parsed.byIndex !== undefined) {
      const member = members[parsed.byIndex - 1];
      if (!member)
        throw new Error(
          `"${path}" wants member #${parsed.byIndex} but "${definition.alias}" ` +
            `has ${members.length}`,
        );
      return member;
    }

    if (parsed.byText) {
      for (const member of members) {
        // iOS folds a row's descendant text into its own label; Android leaves
        // the container empty and puts the text on the children, so fall back
        // to searching inside (confirmed live on both platforms).
        if (((await member.getText()) ?? "").includes(parsed.byText))
          return member;
        const inner = await member.$$(
          browser.isIOS ? ".//*" : ".//*[string-length(@text) > 0]",
        );
        for (const child of inner as unknown as WebdriverIO.Element[]) {
          if (((await child.getText()) ?? "").includes(parsed.byText))
            return member;
        }
      }
      throw new Error(
        `No member of "${definition.alias}" (${members.length} found) contains ` +
          `the text "${parsed.byText}"`,
      );
    }

    // A collection addressed without a filter - hand back the first match.
    return members[0];
  }
}

/**
 * An element the app tags with a testID. The ONLY selector helper - anything
 * else is written as a raw XPath pair at the use site.
 *
 *   ios      .//*[@name="<testID>"]          (testID -> accessibilityIdentifier)
 *   android  .//*[@resource-id="<testID>"]   (testID -> resource-id, unprefixed)
 *
 * Pass several to define a collection as exactly the rows you name, in document
 * order - which is how a section pins a shared collection component to its own
 * members rather than fishing with a pattern:
 *
 *   byTestId("settings.notify.smsToggle", "settings.notify.mailToggle")
 *   -> .//*[@name="settings.notify.smsToggle" or @name="...mailToggle"]
 *
 * Both platforms use XPath and nothing else, so a selector nests the same way
 * everywhere and there is no per-strategy behaviour to remember. The only
 * difference is which attribute holds the testID, which is all this fills in.
 *
 * Written `.//` rather than `//` so one string works both at page level (where
 * `.` is the document root, making it identical to `//`) and as a child, where
 * it must stay inside the parent.
 *
 * Verified live on both platforms. XPath costs ~13% over iOS's native
 * accessibility-id query (319ms vs 283ms per lookup, measured) - paid
 * deliberately, for one strategy instead of three.
 *
 * Note for hand-written XPath: on iOS `@name` falls back to the visible LABEL
 * when an element has no accessibilityIdentifier, so `@name` is only a testID
 * match for elements the app actually tags.
 */
export const byTestId = (...testIds: string[]): PlatformSelector => {
  if (!testIds.length) throw new Error("byTestId needs at least one testID");
  const anyOf = (attr: string) =>
    testIds.map((id) => `@${attr}="${id}"`).join(" or ");
  return {
    ios: `.//*[${anyOf("name")}]`,
    // ⚠️ BOTH Android attributes, because React Native puts `testID` on
    // `resource-id` and `accessibilityLabel` on `content-desc`, and apps use
    // either. Matching both is what lets one page object serve an app tagged
    // whichever way - the alternative is a per-app selector helper and a
    // whole class of "the selector is right but finds nothing" bugs.
    //
    // Costs one extra predicate per lookup. Measured as noise next to the
    // round-trip itself. Keep in step with utils/pageSource.ts, which resolves
    // an id from the same three attributes in the same order.
    android: `.//*[${anyOf("resource-id")} or ${anyOf("content-desc")}]`,
    idPattern: { kind: "exact", ids: [...testIds] },
  };
};

/**
 * A child matched by the END of its testID. Use this ONLY inside a COLLECTION
 * MEMBER, where the row's own id doesn't exist until the row is matched, so
 * there is no prefix to compose a full id from:
 *
 *   Toggles (rows)      .../smsToggle, .../mailToggle, ...
 *     Checked Icon      byTestIdEnding(".checkedIcon")
 *
 * Anywhere else, pass a tail to defineComponent - a full exact id reads better, matches
 * exactly, and doesn't depend on XPath 1.0's lack of ends-with(), which is why
 * this compiles to `substring(@name, string-length(@name) - N) = "..."`.
 *
 * Always pass the leading dot - `.leftValue`, not `leftValue` - so the match is
 * pinned to a whole trailing segment. Note it is not anchored at the FRONT:
 * `.title` would also match `.header.title` if a row had both.
 *
 * It is ENDS-with rather than contains because contains is measurably wrong
 * here: a testID is a prefix of its own children's, so `contains(".fileCount")`
 * also matches `.fileCountBadge`, `contains(".newBadge")` matches
 * `.newBadgeText`, and `contains("Toggle")` returned 15 rows where the grid had
 * 5 (measured live, both platforms).
 *
 * Only unambiguous because it resolves INSIDE a parent - `.header.title` finds
 * one element within a card and every card's at page level. Prefer byTestId
 * wherever the full id is known; it's greppable.
 */
export const byTestIdEnding = (...tails: string[]): PlatformSelector => {
  if (!tails.length) throw new Error("byTestIdEnding needs at least one ending");
  for (const tail of tails)
    if (!tail.startsWith("."))
      throw new Error(
        `byTestIdEnding("${tail}") must start with a dot, so it matches a ` +
          `whole trailing segment`,
      );
  const anyOf = (attr: string) =>
    tails
      .map(
        (tail) =>
          `substring(@${attr}, string-length(@${attr}) - ${tail.length - 1}) = "${tail}"`,
      )
      .join(" or ");
  return {
    ios: `.//*[${anyOf("name")}]`,
    android: `.//*[${anyOf("resource-id")}]`,
  };
};

/**
 * The rows of a list keyed by record id - `<prefix>.<id>`, e.g.
 * `orders.recent.item.3498` - for lists whose ids only exist at runtime and so
 * can't be named with byTestId.
 *
 * The second half of the predicate is what keeps it to the rows: a row's own
 * children are `<prefix>.<id>.name` and friends, which start with the same
 * prefix, so matching the prefix alone returns the whole subtree.
 */
export const byRecordId = (prefix: string): PlatformSelector => {
  const rowsOnly = (attr: string) =>
    `starts-with(@${attr},"${prefix}.") and ` +
    `not(contains(substring-after(@${attr},"${prefix}."),"."))`;
  return {
    ios: `.//*[${rowsOnly("name")}]`,
    android: `.//*[${rowsOnly("resource-id")}]`,
    idPattern: { kind: "row", prefix },
  };
};

/**
 * ONE field of a keyed list's rows, matched ACROSS every row -
 * `<prefix>.<recordId><tail>`, e.g. every `orders.recent.item.<id>.name`.
 *
 * This is what a sort, a membership check or a count over a list reads. A
 * collection addressed with no `#N` / `#text` filter resolves to its FIRST
 * member (see resolveOne), so `List > Rows > Name` quietly reads one row rather
 * than all of them - which silently defeats the assertion.
 *
 * ⚠️ IT PINS BOTH ENDS, and both halves are load-bearing. A bare ends-with on
 * the tail collides with ids elsewhere on the screen (`.value` also matches a
 * summary card's `<prefix>.metric.0.value`, and one list's `.name` matches
 * another's), while the prefix alone matches a row's whole subtree.
 *
 * ⚠️ AND IT DELIBERATELY DOES NOT APPLY byRecordId's no-dot RULE. A deeper
 * descendant that happens to end with the same tail is matched, exactly as it
 * has always been - this builder replaced three byte-identical copies across
 * three page objects, and unifying them was not the moment to change what any of
 * them matches. The idPattern therefore describes the loose rule too, so the
 * page-source fast path and the XPath return the same rows. Tighten both
 * together or neither.
 */
export const rowField = (prefix: string, tail: string): PlatformSelector => {
  if (!tail.startsWith("."))
    throw new Error(`rowField("${prefix}", "${tail}") needs a leading dot on its tail`);
  const predicate = (attr: string) =>
    `starts-with(@${attr},"${prefix}.") and ` +
    `substring(@${attr}, string-length(@${attr}) - ${tail.length - 1}) = "${tail}"`;
  return {
    ios: `.//*[${predicate("name")}]`,
    android: `.//*[${predicate("resource-id")}]`,
    idPattern: { kind: "rowField", prefix, tail },
  };
};
