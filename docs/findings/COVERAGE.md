# Coverage

What the suite checks, and - more usefully - **what it does not**.

> The "Does not cover" lists are the point of this file. They are the difference
> between "the suite is green" and "the app works", and they are what an exploratory
> charter is aimed at. `npm run explore:index -- gaps` reads them.
>
> ⚠️ **A known gap is not a finding.** Before writing anything into `APP_ISSUES.md`,
> check here: if the behaviour was never covered, that is a gap to close with a test,
> not a bug to report.

**Format is load-bearing** - `scripts/findings-index.mjs` parses it:

```
## <Screen> - <n> tests
### Covers
- ...
### Does not cover
- ...
```

---

## Catalog - 8 tests

`test/specs/catalog.e2e.ts`, against [REQ-002](../../requirements/REQ-002-catalog.md).

### Covers
- Launching the app lands on the catalogue, headed *Products* (R2.1)
- Every product shows a name and a `$0.00`-formatted price (R2.2)
- Each price is read from **inside** its own cell, so it can only be that
  product's (R2.3)
- *Sauce Labs Backpack* is listed at $29.99 (R2.4)
- The sort sheet offers name and price, both directions (R2.5)
- Choosing an ordering actually reorders the list, ascending and descending (R2.5)
- The header always offers the cart (R2.6)
- Scrolling reveals products the tree did not previously hold (R2.7)

### Does not cover
- Product detail: images, description, size and colour selection
- Adding to cart from the catalogue, and the cart badge count
- Empty and error states for the product list
- Star ratings: read but not asserted against a source of truth
- Products below the fold are not paired name-to-price (only the visible ones are)

## Login - 8 tests

`test/specs/login.e2e.ts`, against [REQ-001](../../requirements/REQ-001-login.md).

### Covers
- The drawer's Log In entry opens the form, with both fields and the button (R1.1)
- Valid credentials sign in and return to the catalogue (R1.2)
- An empty username is refused with *Username is required* (R1.3)
- An empty password is refused with *Password is required* (R1.4)
- A wrong password is refused with the generic credentials error (R1.5)
- A locked-out account is refused with a **distinguishable** message (R1.6)
- Signing out asks for confirmation (R1.7) — ⚠️ **red**, see [A1](APP_ISSUES.md)
- Cancelling the confirmation leaves the session intact (R1.8)

### Does not cover
- Whether a session survives an app relaunch
- What the drawer's Log In entry does when already signed in (it opens the cart —
  see [app-quirks](../reference/app-quirks.md))
- Registration, password reset, biometric unlock — none exist in this build
