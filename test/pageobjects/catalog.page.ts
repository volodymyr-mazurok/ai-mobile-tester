import { browser } from "@wdio/globals";
import { byTestId, Component } from "./abstraction/component";
import MobilePage from "./page";

/**
 * The product catalogue - the app's landing screen.
 *
 * ⚠️ THIS SCREEN IS WHY THE ONE RULE EXISTS. Every product cell answers to the
 * SAME id, and so does every field inside it. Verified on a live capture:
 *
 *   products screen
 *     store item                  ← 6 of these, identical id
 *       store item text           ← the name;  6 of these, identical id
 *       store item price          ← the price; 6 of these, identical id
 *       review star 1 … 5
 *     store item
 *       …
 *
 * So `store item price` alone is ambiguous six ways over: there is no such thing
 * as "the price" on this screen, only "the price INSIDE this row". Declaring
 * Price as a child of Products - and addressing it as
 * `#2 of Products > Price` - is what makes it mean anything at all.
 *
 * The alternative, reading two flat lists and pairing them by position, would
 * pass just as often and prove nothing: it assumes the two lists are in the same
 * order, which is exactly what R2.3 exists to check.
 *
 * Filed as testability ask #1 - the app should give each cell a stable per-product
 * id. Until it does, this is what is true.
 */

/** One product cell. Its fields are looked up INSIDE it. */
class ProductCell extends Component {
  constructor() {
    super({ alias: "Products", selector: byTestId("store item"), isCollection: true });
    this.defineComponent({ alias: "Name", selector: byTestId("store item text") });
    this.defineComponent({ alias: "Price", selector: byTestId("store item price") });
    this.defineComponent({ alias: "Rating", selector: byTestId("review star 1"), isCollection: false });
  }
}

class CatalogPage extends MobilePage {
  constructor() {
    super("Catalog");

    this.defineComponent({ alias: "Root", selector: byTestId("products screen") });
    // ⚠️ The title is a CHILD TextView, and it has to be addressed as one. The
    // container itself carries no text, and `getText` falls back to
    // `content-desc` on Android - so asking the container returns the literal
    // string "container header" rather than "Products", and an assertion on it
    // fails with a baffling message. Verified on a live capture.
    const header = new (class extends Component {
      constructor() {
        super({ alias: "Header", selector: byTestId("container header") });
        this.defineComponent({
          alias: "Title",
          selector: { ios: ".//*", android: ".//android.widget.TextView" },
        });
      }
    })();
    this.defineComponent(header);
    this.defineComponent({ alias: "Menu Button", selector: byTestId("open menu") });
    this.defineComponent({ alias: "Sort Button", selector: byTestId("sort button") });
    this.defineComponent({ alias: "Cart Badge", selector: byTestId("cart badge") });

    // THE SORT SHEET - declared FLAT, at page level, with full ids.
    //
    // ⚠️ Rule 3. It is a React Native modal presented OVER the screen, not inside
    // the button that opened it. Nesting these under "Sort Button" would read
    // naturally and resolve nothing.
    this.defineComponent({ alias: "Sort Sheet", selector: byTestId("active option") });
    this.defineComponent({ alias: "Sort Name Asc", selector: byTestId("nameAsc") });
    this.defineComponent({ alias: "Sort Name Desc", selector: byTestId("nameDesc") });
    this.defineComponent({ alias: "Sort Price Asc", selector: byTestId("priceAsc") });
    this.defineComponent({ alias: "Sort Price Desc", selector: byTestId("priceDesc") });

    this.defineComponent(new ProductCell());

    // Flat lists of the same fields, for the cheap whole-screen read.
    //
    // ⚠️ These exist for COST, not convenience. Reading a field per row costs one
    // driver round-trip each; `getTexts()` on a collection whose selector knows
    // its id shape is answered from ONE page source (see utils/pageSource.ts).
    // Use them to survey the screen - never to pair a name with a price, which
    // is what the nested lookup above is for.
    this.defineComponent({
      alias: "All Names", selector: byTestId("store item text"), isCollection: true,
    });
    this.defineComponent({
      alias: "All Prices", selector: byTestId("store item price"), isCollection: true,
    });
  }

  /**
   * Every product currently ON SCREEN, each read from INSIDE its own cell.
   *
   * ⚠️ WHY THIS IS A PAGE-OBJECT METHOD AND NOT A LOOP IN THE SPEC. The obvious
   * spec-side version - `#1 of Products > Name`, `#2 of Products > Name`, … -
   * re-resolves the whole collection on every single lookup. Measured on this
   * six-product screen: **3,092 driver calls**, which tripped the framework's own
   * four-figure warning (rule 9). This resolves the cells ONCE and reads within
   * each, for a fraction of that.
   *
   * ⚠️ AND IT SKIPS ROWS THAT ARE NOT DISPLAYED. On Android the page source holds
   * everything LAID OUT, so `getCount` happily reports six cells while the last
   * one is below the fold - and asking it for text then burns a full 10s timeout
   * before failing. Laid out is not the same as displayed; this is the standing
   * Android trap (docs/reference/app-quirks.md).
   *
   * ⚠️ The expense here is a direct consequence of testability finding #1. If the
   * app gave each cell a per-product id, this would be one page-source read.
   */
  async visibleProducts(): Promise<Array<{ name: string; price: string }>> {
    const cells = await this.findAll("Products");
    const cell = this.child("Products");
    const nameLocator = cell.child("Name").locator(browser.isIOS);
    const priceLocator = cell.child("Price").locator(browser.isIOS);

    const out: Array<{ name: string; price: string }> = [];
    for (const element of cells) {
      if (!(await element.isDisplayed())) continue;

      // ⚠️ `$$` AND A LENGTH CHECK, never `$(...).getText()`.
      //
      // Not every cell holds both fields. The exploratory sweep measured it
      // first: SIX `store item` cells against FOUR `store item text` - a row at
      // the fold is laid out as a cell before its contents mount. `$()` returns
      // a lazy element that only throws when used, and calling getText on the
      // missing one retried its way to ~3,000 driver calls before failing (rule
      // 9's four-figure warning fired on exactly this).
      //
      // Reading the sweep's own output would have saved the round trip. That is
      // what it is for.
      const [nameEl] = await element.$$(nameLocator);
      const [priceEl] = await element.$$(priceLocator);
      if (!nameEl || !priceEl) continue;

      out.push({
        name: (await nameEl.getText()) ?? "",
        price: (await priceEl.getText()) ?? "",
      });
    }
    return out;
  }
}

export default new CatalogPage();
