---
name: create-page-object
description: Add or extend a page object (a Component tree) for a screen of the app under test. Use when automating a new screen, or when an existing page object is missing elements a test needs.
---

# Create a page object

Full reference: [docs/architecture/page-objects.md](../../../docs/architecture/page-objects.md).
Per-screen oddities already measured live:
[docs/reference/app-quirks.md](../../../docs/reference/app-quirks.md) - **read that
first**, it may already answer what you're about to discover the hard way.

## Step 1 - inspect the real screen

Never write a selector from memory, from the app's source, or by guessing. Use
`inspect-live-screen` to capture the live tree, then:

```bash
npm run capture:tree                  # reads ./.inspect
```

It prints what the app has that isn't declared, what's declared but wasn't captured,
and a paste-ready skeleton grouped by prefix.

Two categories of "declared but not captured" are **expected, not drift**: a node
that only groups children, and a state-dependent child (a ticked checkbox has
`checkedIcon`, an unticked one has `box` - never both).

## Step 2 - work out the real ANCESTRY

The step that matters, and the skeleton cannot do it for you.

**THE ONE RULE: a child is looked up INSIDE its parent's element.** Walk up from the
element in the captured XML and note which *tagged* elements actually enclose it. You
may skip levels - "inside" means descendant at any depth - but a **sibling declared as
a child type-checks fine and resolves to nothing**.

The app is inconsistent, so check rather than assume:

| genuinely contains its children | a background view - children are SIBLINGS |
|---|---|
| a titled card (`<prefix>.card`) | every `<screen>.header` - its title and buttons are SIBLINGS |
| a list row keyed by record id, and its fields | a row's own `*.card` wrapper, and `<screen>.header.title` |
| a list row keyed by record id | a bottom sheet presented over the screen |
| the header's two buttons over their icons | `documents.toolbar` |

⚠️ **Every React Native `<Modal>` is declared FLAT, at page level, with full ids** -
including ones whose captured tree looks properly nested. A modal is presented in its
own hosting view, and a nested lookup does not reliably resolve the presented copy.
Use compound aliases (`New Folder Name Input`) since there's no parent to walk through.

⚠️ **On Android, check the CONTAINER resolves before blaming the app.**
A scroll container can be absent from Android's tree while its own child
tiles are present - a nested lookup there can never succeed. That cost a wrong bug
report that had to be withdrawn. Declare the children flat instead.

## Step 3 - write it

```ts
import { Component, byTestId } from "./abstraction/component";
import MobilePage from "./page";

class SomeSection extends Component {
  constructor() {
    super({ alias: "Some Section", prefix: "somescreen.someSection",
            selector: byTestId("somescreen.someSection.card") });
    this.defineComponent({ alias: "Amount", selector: "amountValue" });   // -> …someSection.amountValue
  }
}

class SomeScreenPage extends MobilePage {
  constructor() {
    super("Some Screen", "somescreen");           // shared chrome from page.ts, inherited
    this.defineComponent({ alias: "Scroll", selector: byTestId("somescreen.scroll") });
    this.defineComponent(new SomeSection());
  }
}

export default new SomeScreenPage();
```

- **Extend `MobilePage`** for a top-level screen - it brings whatever shared chrome
  `page.ts` declares (header, tab bar, drawer). Don't redeclare those.
- **One method adds a child**: `defineComponent({ alias, selector, isCollection? })`,
  or `defineComponent(new SomeSection())` when it has children or constructor logic.
  A childless component is simply a leaf.
- **Factor a repeating shape into `test/pageobjects/components/`** once you have
  declared it twice - a titled card, a list row, a preference toggle. **One instance
  per parent**: a `Component` belongs to a single parent, and sharing one throws.
- **Redeclaring an alias overrides it**, which is how a subclass specialises an
  inherited component.
- **`prefix` is stated, not derived.** Apps are inconsistent: `settings.account.card`
  holds `settings.account.emailValue` (prefix = id minus last segment) while
  `settings.logoutButton` holds `settings.logoutButton.label` (prefix = the whole id).
- Name things for what a person calls them ("Reset Password Button", not "btn3").
- Comment **why** a selector is unusual - a platform divergence, an app quirk, a
  workaround. Not what the code does.

## Step 4 - selectors: four builders, and a tail

Everywhere it can, a child names just its **tail**, expanded against the parent's
prefix into a full exact id. Otherwise:

- **`byTestId(...ids)`** - full exact ids; several for a collection pinned to exactly
  those rows.
- **`byRecordId(prefix)`** - rows of a list keyed by a runtime id
  (`orders.recent.item.3498`). Its `not(contains(substring-after(...)))` half is what
  keeps it to the rows and off their children.
- **`rowField(prefix, tail)`** - ONE field of those rows, read ACROSS every row
  (`orders.recent.item.<id>.name`). What a sort, a membership check or a count needs -
  and the thing that makes `getTexts`/`getIds`/`getCount` answer from one page source
  instead of a round-trip per row.
- **`byTestIdEnding(...tails)`** - **only inside a collection member**, where the
  row's id isn't known until the row is matched. Pass the leading dot (`.name`).
- **No testID at all?** Hand-write the `{ios, android}` XPath pair - the case is a
  hosted login page, whose markup is not the app's to tag. Pin iOS to a concrete
  element type (`XCUIElementTypeSecureTextField`): `@name` matches the wrapping
  container too, and document order puts the container first, so an unpinned selector
  types into nothing and throws nothing.

⚠️ **A row-spanning read needs its own collection.** A collection addressed with no
`#N` / `#text` filter resolves to its **first member**, so `List > Documents > Name`
quietly reads one document - silently defeating any sort or total assertion. Declare
`Names` / `Dates` as separate row-spanning collections, pinned at both ends of the id.

⚠️ **A selector that knows its id SHAPE is orders of magnitude cheaper to read.**
`byRecordId` and row fields record an `IdPattern`, which lets `getTexts`/`getIds`
answer from one page source instead of one round-trip per member. That is what took a
98-row grid read from ~396 calls to 1. Prefer them over an ad-hoc collection.

## Step 5 - verify before claiming it works

1. `npm run capture:tree` again - the new declarations should disappear from the
   "not declared" list.
2. **Resolve the paths against a live device, on both platforms.** A path that
   type-checks can still be a mis-nested sibling, and Android's page source contains
   only what is laid out.
3. `npx tsc --noEmit`.
