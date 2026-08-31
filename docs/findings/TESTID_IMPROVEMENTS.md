# Testability asks

Changes to **the app** that would make it cheaper to test. Not bugs - the app works;
it is just harder to address than it needs to be.

Worth keeping separate from `APP_ISSUES.md` because the audience is different: this
is a conversation with the app team about their accessibility tree, and it is the
single highest-leverage thing they can do for automated testing.

**Format.** `## <n>. <summary>`. `npm run explore:index` indexes these as `#<n>`.

---

## 1. Product cells share one accessibility id across every row

- **Screen** Catalog (`products screen`)
- **Now** every product cell is `store item`, its title `store item text`, its price
  `store item price`, its rating `review star 1..5`. On a 6-product screen that is
  **6 matches for every one of 8 ids** - measured by the sweep charter,
  `.explore/sweep-android/`.
- **Cost to testing** nothing can be addressed by name. "Assert the Backpack costs
  $29.99" has to resolve the row by *index* or by *text*, and both break the moment
  the catalogue is re-sorted or restocked - which the app's own sort control does.
- **Ask** suffix the ids with something stable per product, e.g.
  `store item <sku>` / `store item price <sku>`.
- **Workaround meanwhile** scope the child lookup inside the matched parent row
  (THE ONE RULE), and select the row by its visible text.

## 2. A product cell is laid out before its contents mount

- **Screen** Catalog (`products screen`)
- **Now** the tree can hold **six** `store item` cells while only **four** carry a
  `store item text` - measured by the sweep, and hit again by
  `catalog.e2e.ts` when a naive read assumed every cell had both fields.
- **Cost to testing** a cell that exists but is empty is indistinguishable from one
  that failed to render. Any per-row read must tolerate it, and a lazy `$()` that
  only throws on use turns it into ~3,000 wasted driver calls.
- **Ask** either mount the cell with its content, or tag the placeholder state so a
  test can tell "not ready" from "broken".
- **Workaround meanwhile** `$$` plus a length check, and skip. See
  `CatalogPage.visibleProducts()`.

*Both entries are worked examples. Delete them when you point this framework at your
own app.*
