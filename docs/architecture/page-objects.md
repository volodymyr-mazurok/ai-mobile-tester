# Page objects

**Specs never touch a selector or a raw `$()`.** They talk to `ActionHelper`,
which walks a tree of `Component`s declared by a page object.

## One entity

`test/pageobjects/abstraction/component.ts` defines **`Component`**, and that is
the only kind of node. A page, a section, a collection and a leaf differ only in
whether they have a selector and whether they have children:

| | selector | children |
|---|---|---|
| a page | no - it IS the document root | yes |
| a section | yes | yes |
| a collection | yes, matching many | usually |
| a leaf | yes | no |

A page object declares its tree in the constructor. One entity means **one** way
to add a child - whether it turns out to be a leaf, a collection or a whole
section is a property of the thing, not a different method:

```ts
class AccountSection extends Component {
  constructor() {
    super({ alias: "Account Section", prefix: "settings.account",
            selector: byTestId("settings.account.card") });
    this.defineComponent({ alias: "Email", selector: "emailValue" });  // -> settings.account.emailValue
  }
}
```

`defineComponent` takes either an init object (`{ alias, selector, isCollection? }`)
or an already-built `Component`. Pass a built one when it has children of its own
or constructor logic (`new AccountSection()`).

Redeclaring an alias **overrides** it, which is how a subclass specialises an
inherited component: whatever a base class declared, a subclass replaces by
declaring the same alias again.

## THE ONE RULE

**A child is always looked up INSIDE its parent's element**, so the declared tree
has to mirror the real accessibility tree. You may skip intermediate nodes -
"inside" means descendant at any depth - but you may **not** declare a SIBLING as
a child; it resolves to nothing.

**Apps are not consistent about this, so check a live capture before nesting**
(`inspect-live-screen` skill). The shapes that catch people out, all confirmed
live in a real React Native app:

| usually genuinely contains its children | usually a background view - children are SIBLINGS |
|---|---|
| a titled card (`<prefix>.card`) | a screen header: the title, logo and buttons sit BESIDE it |
| a list row keyed by record id | a toolbar: its search and sort controls sit beside it |
| a button wrapping its own icon and label | a bottom sheet presented over the screen |

Two failure shapes are worth naming, because they mislead in opposite directions.
An id ending `.list` may be the scroll container for the WHOLE screen rather than
for the list; and an id you can see in the app may not be an element at all -
`x.thing` absent while only `x.thing.list` exists.

### Modals must be declared FLAT

**Every React Native `<Modal>` is declared flat, at page level, with full ids.** A
modal is presented in its own hosting view, so the ancestor a nested lookup
resolves to is not always the copy on screen: measured with a modal plainly up and
its own container id resolving fine, a nested `<Modal> > Name Input` came back
"element wasn't found" for the input, the confirm button *and* the close button.

A page-root search finds the element whether the modal contains it or not, so flat
is strictly safer. The aliases end up compound - `New Folder Name Input`,
`Delete Confirm Button` - because there is no parent to walk through. The same
applies to a drawer rendered over the screen. Rule 3.

### The same trap without a modal

When a nested lookup fails on **Android** for an element that is plainly on screen,
check whether the CONTAINER resolves at all before concluding anything about the
app. A scroll container can be absent from Android's tree while its own child tiles
are in it - so declare those children FLAT at page level instead, alongside any
row-spanning collections.

Reading "not found" as "the app didn't draw it" is one of the four artefacts rule
13 names, and it has produced a finding that had to be withdrawn.

### Reading a field ACROSS rows needs its own collection

A collection addressed with no `#N` / `#text` filter resolves to its **first
member** (`Component.resolveOne` ends `return members[0]`), so `List > Rows > Name`
quietly reads one row rather than all of them - which silently defeats any sort or
total assertion. Declare a row-spanning collection instead (`Names`, `Dates`),
with `rowField()`, which pins **both** ends of the id so a bare `.name` cannot also
match something else on the screen.

## Selectors: XPath, both platforms, always

iOS `.//*[@name="<id>"]`, Android `.//*[@resource-id="<id>"]`. One strategy, so
nesting behaves identically everywhere. `~` and `-ios predicate string:` are
gone. On iOS a testID becomes the `accessibilityIdentifier`, surfaced as `@name`;
on Android it becomes `resource-id`, **unprefixed** (`auth.screen`, not
`com.example.app:id/auth.screen`). Measured cost of XPath over iOS's native
accessibility-id query: ~13% (319ms vs 283ms per lookup) - paid deliberately.

Four builders, and only four:

- **`byTestId(...ids)`** - full exact ids. Pass several for a collection pinned
  to exactly those rows.
- **`byTestIdEnding(...tails)`** - matches the END of an id. **Only valid inside a
  collection member**, where the row's id doesn't exist until the row is matched.
  Pass the leading dot (`.checkedIcon`). Not anchored at the front, so `.title`
  would also match `.header.title`.
- **`byRecordId(prefix)`** - the rows of a list keyed by a runtime id
  (`orders.recent.item.3498`). The `not(contains(substring-after(...)))` half is
  what keeps it to rows: a row's children carry the row id as their prefix, so
  matching the prefix alone returns the whole subtree (measured: 15 where the grid
  had 5).
- **`rowField(prefix, tail)`** - ONE field of those rows, matched ACROSS every row
  (`orders.recent.item.<id>.name`). This is what a sort, a membership check or a
  count reads. ⚠️ It is also what makes `getTexts`/`getIds`/`getCount` cheap: it
  records an `IdPattern`, so the whole answer comes out of one page source instead
  of a round-trip per row. See [performance.md](performance.md).

Everywhere else a child names just its **tail**, expanded against its parent's
`prefix` into a full exact id - so the prefix is written once and the selector is
still an exact match you can paste into Appium Inspector:

```
Settings > Account Section > Email
//*[@name="settings.account.card"]//*[@name="settings.account.emailValue"]
```

`prefix` is **stated, not derived**, because apps are inconsistent:
`settings.account.card` holds `settings.account.emailValue` (prefix = id minus
last segment) while `settings.logoutButton` holds `settings.logoutButton.label`
(prefix = the whole id). Guessing between those would be a coin flip.

**A screen with an id shape none of the four can express gets a local builder in
its own page object.** That is expected, not a workaround - one real case needed
`byRecordId`'s no-further-dot rule applied to the MIDDLE of an id rather than its
start. Keep it local until a second screen needs the same shape.

**A screen with NO testIDs at all** - a hosted login page whose markup is not the
app's to tag - gets hand-written `{ ios, android }` XPath pairs. On iOS `@name`
falls back to an element's visible LABEL when it has no identifier, which is what
makes that work. See [authentication.md](authentication.md).

## Addressing elements

`utils/actionHelper.ts` is **the only thing specs call**. Set the page once, then
use alias paths:

```ts
ActionHelper.setCurrentPage(Settings);
await ActionHelper.click("Notifications Section > #Weekly in Toggles");
expect(await ActionHelper.getText("Account Section > Email")).toBe("a@example.com");
```

Path grammar:

```
"Account Section > Email"           walk into a child
"#Weekly in Toggles"                the collection member containing that text
"#2 of Toggles"                     the member at that 1-based index
"#Weekly in Toggles > Checked Icon" ...then into that member's children
```

An unknown alias throws listing what is available. `#N`/`#text` on a
non-collection throws too.

The actions themselves live in **`utils/actions.ts`** as free functions over
`(component, path)`, so they exist exactly once: `ActionHelper` wraps them with
the current page, and a page object's own flow method (a `LoginPage`'s `signIn`)
calls them directly - going back through `ActionHelper` would be a dependency
cycle. **Don't add action methods to `Component`**; that is what having two of
everything looked like before.

`ActionHelper.scroll(direction, times)` is page-independent (implemented in
`utils/gestures.ts`). Use `isExisting` rather than `isDisplayed` when the element
may be off-screen - a ticked row's `Checked Icon`, for instance - but read
[waits.md](waits.md) first: rule 6, `isExisting` is a point-in-time read and on an
async screen it has to be waited *on*.

Resolving a collection member BY TEXT handles one real cross-platform difference:
iOS folds a row's descendant text into the container's own label, but **Android
leaves the container empty and puts the text on the children** - so
`Component.resolveOne` searches the members first and falls back to scanning the
subtree (`findMemberByText` in `utils/pageSource.ts` answers it from one page
source where the selector carries an `IdPattern`).

## Shared components

A shape that repeats across screens - a titled card, a row of a list, a preference
toggle - is worth one `Component` subclass rather than one declaration per screen.
Put those in `test/pageobjects/components/`; the boilerplate ships none, because
which shapes repeat is a property of your app's design system, not of the framework.

**Construct one per parent.** A `Component` belongs to a single parent, so the same
instance cannot be defined under two screens - it throws.

## The page objects

Two ship with the framework, and both are yours to extend:

- **`page.ts`** (`MobilePage`) - the base every screen extends. It has no selector,
  because a page IS the document root. **Put your app's shared chrome here** - the
  header, a tab bar, a nav drawer - and a page object then describes only what makes
  its screen different.
- **`screens.ts`** - the map the generic passes walk, plus `DrawerScreen` /
  `HeaderScreen` for the two common ways a screen is reached. One of the three files
  you edit to adopt the framework.

One file may export several screens - a list screen and its detail screen usually
belong together. This branch adds `login.page.ts` and `catalog.page.ts` for the demo
app; on `main` there are none.

Per-screen accessibility-tree oddities go in
[reference/app-quirks.md](../reference/app-quirks.md).

## Drift detection

**`npm run capture:tree`** diffs a live capture against the committed page
objects and prints a paste-ready skeleton grouped by prefix. Expect a residue of
"in the app but NOT declared" - pure layout wrappers (`*.section`, `*.body`,
`*.row`, `*.column`) that no test addresses. Run it after any app release.

⚠️ **It reads the XPath, not the builder.** `byTestId` and `byTestIdEnding` are
matched exactly; `byRecordId` and `rowField` both open with
`starts-with(@name,"<prefix>.")`, so both are treated as a wildcard over that whole
prefix. That is deliberately the SAFE direction - a `rowField` for `.name` also
suppresses `.date` under the same prefix, so the tool under-reports drift rather
than inventing it. Don't read a clean run as proof every declared id still exists;
that is what resolving the paths against a live device is for.

Because ids are **composed** from a prefix, `grep settings.account.emailValue`
finds nothing in the repo. `capture:tree` is the compensating control for that -
it is the only thing that will tell you the app renamed something.
