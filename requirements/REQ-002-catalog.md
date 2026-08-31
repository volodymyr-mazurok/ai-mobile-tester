# REQ-002: Product catalogue

## Context

The catalogue is the app's home screen and the first thing every customer sees. It
lists the products on sale in a two-column grid, and is the entry point to product
detail and to the cart.

## Requirements

**R2.1 — The catalogue is the landing screen.**
Launching the app shows the product catalogue, headed *Products*.

**R2.2 — Every product shows name, price and rating.**
Each cell shows the product name, its price formatted as a currency amount, and a
star rating out of five.

**R2.3 — Prices belong to their product.**
The price and rating shown in a cell are those of the product named in that same
cell. (Stated explicitly because the grid re-orders: see R2.5.)

**R2.4 — A known product is listed correctly.**
*Sauce Labs Backpack* is present, priced **$29.99**.

**R2.5 — Sorting.**
The sort control offers ordering by name and by price, ascending and descending.
Choosing one re-orders the visible list accordingly, and the chosen ordering is
reflected on screen.

**R2.6 — The cart badge.**
The header shows a cart control at all times. With an empty cart it shows no count.

**R2.7 — Scrolling.**
The catalogue scrolls, and products below the fold become visible and readable.

## Out of scope

- Product detail (a separate requirement).
- Adding to cart, checkout, payment.
- Search and filtering — neither exists in this build.
- Product images: presence only, no visual comparison.

## Notes

- The grid is two columns on a phone.
- All product cells share the same accessibility identifiers, so a test cannot
  address a product by name directly — it must match the row and read within it. This
  is a known testability limitation, not a defect
  (`docs/findings/TESTID_IMPROVEMENTS.md` #1).
