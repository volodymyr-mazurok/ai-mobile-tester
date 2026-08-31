import { expect } from "@wdio/globals";
import ActionHelper from "../../utils/actionHelper";
import CatalogPage from "../pageobjects/catalog.page";
import { relaunchOurApp, waitForAppReadyOrRecover } from "../support/session";
import { scaled, suiteTimeout } from "../support/timeouts";

/**
 * REQ-002: Product catalogue. See requirements/REQ-002-catalog.md.
 *
 * ⚠️ NO SIGN-IN. This app browses without a session, so a suite that signed in
 * would be paying for the flakiest flow it has in order to prove nothing about
 * the screen under test.
 */
describe("Catalog (REQ-002)", function () {
  this.timeout(suiteTimeout());

  before(async () => {
    await relaunchOurApp();
    await waitForAppReadyOrRecover();
    ActionHelper.setCurrentPage(CatalogPage);
    await ActionHelper.waitForDisplayed("Root", scaled(30_000));
  });

  /**
   * ⚠️ WAITS, every time - it does not merely set the page.
   *
   * When a test fails, the framework's afterTest recovery relaunches the app.
   * The next test then starts against a screen that is still mounting, and the
   * page-source fast path reads an empty tree: `getCount("Products")` returns 0
   * and THREE more tests fail with "expected > 0, received 0". One real failure
   * became four, and none of the three said anything true (rule 10).
   */
  beforeEach(async () => {
    ActionHelper.setCurrentPage(CatalogPage);
    if (!(await ActionHelper.isDisplayed("Root"))) {
      await relaunchOurApp();
      await waitForAppReadyOrRecover();
      ActionHelper.setCurrentPage(CatalogPage);
    }
    await ActionHelper.waitForDisplayed("Root", scaled(30_000));
    await ActionHelper.waitForCount("Products", 1, scaled(30_000));
  });

  it("R2.1 - launching the app lands on the catalogue", async () => {
    expect(await ActionHelper.isDisplayed("Root")).toBe(true);
    expect(await ActionHelper.getText("Header > Title")).toBe("Products");
  });

  it("R2.2 - every product shows a name and a currency-formatted price", async () => {
    const names = await ActionHelper.getTexts("All Names");
    const prices = await ActionHelper.getTexts("All Prices");

    // ⚠️ Containment and relationships, not a fixture size (rule 15). A restocked
    // catalogue must not break this - only an EMPTY one should.
    expect(names.length).toBeGreaterThan(0);
    expect(prices.length).toBe(names.length);

    for (const name of names) expect(name.trim().length).toBeGreaterThan(0);
    for (const price of prices) expect(price).toMatch(/^\$\d+\.\d{2}$/);
  });

  it("R2.3 - each price belongs to the product it is drawn beside", async () => {
    // ⚠️ THE POINT OF THIS TEST. Both fields come from INSIDE the same cell
    // element, so a row can only ever report its own price. Pairing two flat
    // lists by position would pass identically today and prove nothing - it
    // would assume the very ordering this test exists to check.
    const products = await CatalogPage.visibleProducts();

    expect(products.length).toBeGreaterThan(1);
    for (const { name, price } of products) {
      expect(name.trim().length).toBeGreaterThan(0);
      expect(price).toMatch(/^\$\d+\.\d{2}$/);
    }
  });

  it("R2.4 - Sauce Labs Backpack is listed at $29.99", async () => {
    const products = await CatalogPage.visibleProducts();
    const backpack = products.find((p) => p.name.trim() === "Sauce Labs Backpack");

    expect(backpack).toBeDefined();
    expect(backpack!.price).toBe("$29.99");
  });

  it("R2.5 - the sort control offers name and price orderings, both directions", async () => {
    await ActionHelper.click("Sort Button");
    await ActionHelper.waitForDisplayed("Sort Price Asc", scaled(15_000));

    for (const option of ["Sort Name Asc", "Sort Name Desc", "Sort Price Asc", "Sort Price Desc"])
      expect(await ActionHelper.isDisplayed(option)).toBe(true);

    // Close without changing anything - the next test owns the reorder.
    await ActionHelper.click("Sort Price Asc");
    await ActionHelper.waitForDisplayed("Root", scaled(15_000));
  });

  it("R2.5 - choosing an ordering actually reorders the visible list", async () => {
    const amounts = async (): Promise<number[]> =>
      (await ActionHelper.getTexts("All Prices")).map((p) => Number(p.replace(/[^0-9.]/g, "")));

    const ascending = await amounts();
    // ⚠️ Asserts the ORDER, not the contents. A restocked catalogue changes what
    // is listed and must not break this; only a broken sort should.
    expect([...ascending].sort((a, b) => a - b)).toEqual(ascending);

    await ActionHelper.click("Sort Button");
    await ActionHelper.waitForDisplayed("Sort Price Desc", scaled(15_000));
    await ActionHelper.click("Sort Price Desc");
    await ActionHelper.waitForDisplayed("Root", scaled(15_000));

    const descending = await amounts();
    expect([...descending].sort((a, b) => b - a)).toEqual(descending);
    expect(descending).not.toEqual(ascending);
  });

  it("R2.6 - the header always offers the cart", async () => {
    expect(await ActionHelper.isDisplayed("Cart Badge")).toBe(true);
  });

  it("R2.7 - products below the fold become readable when scrolled to", async () => {
    const before = await ActionHelper.getTexts("All Names");
    await ActionHelper.scroll("down", 3);
    const after = await ActionHelper.getTexts("All Names");

    // ⚠️ ANDROID'S PAGE SOURCE HOLDS ONLY WHAT IS LAID OUT, so a product below
    // the fold is genuinely ABSENT from `before` rather than present-but-hidden.
    // That is the assertion: scrolling reveals names the tree did not have.
    const revealed = after.filter((n) => !before.includes(n));
    expect(revealed.length).toBeGreaterThan(0);

    await ActionHelper.scroll("up", 3);
  });
});
