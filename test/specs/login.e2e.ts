import { expect } from "@wdio/globals";
import ActionHelper from "../../utils/actionHelper";
import { withoutRepeatedPhrase } from "../../utils/copy";
import LoginPage from "../pageobjects/login.page";
import { Catalog, Login, visit } from "../pageobjects/screens";
import { appContract } from "../support/appContract";
import { ensureSignedOut, relaunchOurApp, waitForAppReadyOrRecover } from "../support/session";
import { scaled, suiteTimeout } from "../support/timeouts";

/**
 * REQ-001: Login. See requirements/REQ-001-login.md.
 *
 * ⚠️ TEST ORDER IS DELIBERATE, and it is about cost. Signing in is the slowest and
 * flakiest thing this suite does, so every test that can run SIGNED OUT runs first
 * (R1.1, R1.3-R1.6), then the one that signs in (R1.2), then the two that need a
 * session (R1.7, R1.8). One sign-in for the whole file instead of three.
 *
 * ⚠️ This file signs the app OUT, so it is listed in PRE_AUTH_SPECS
 * (config/wdio/specOrder.ts) and runs after any authenticated suite.
 */
describe("Login (REQ-001)", function () {
  this.timeout(suiteTimeout());

  /** Back to a clean, empty login form - from wherever the previous test left the app. */
  async function openCleanForm(): Promise<void> {
    await relaunchOurApp();
    await waitForAppReadyOrRecover();
    await visit(Login);
    await LoginPage.waitForForm();
  }

  before(async () => {
    // The app browses without a session, and a previous spec file may have left one.
    // ensureSignedOut() alternates logout and reinstall until the form is reachable.
    await ensureSignedOut();
  });

  describe("signed out", () => {
    beforeEach(openCleanForm);

    it("R1.1 - the drawer's Log In entry opens the login form", async () => {
      ActionHelper.setCurrentPage(LoginPage);
      expect(await ActionHelper.isDisplayed("Screen")).toBe(true);
      expect(await ActionHelper.isDisplayed("Username")).toBe(true);
      expect(await ActionHelper.isDisplayed("Password")).toBe(true);
      expect(await ActionHelper.isDisplayed("Login Button")).toBe(true);
    });

    it("R1.3 - an empty username is refused with a field-level message", async () => {
      await LoginPage.signIn("", "10203040");

      expect(await LoginPage.errorText("Username Error")).toBe("Username is required");
      // Still on the form: a refused submit must not navigate.
      ActionHelper.setCurrentPage(LoginPage);
      expect(await ActionHelper.isDisplayed("Screen")).toBe(true);
    });

    it("R1.4 - an empty password is refused with a field-level message", async () => {
      await LoginPage.signIn("bob@example.com", "");

      expect(await LoginPage.errorText("Password Error")).toBe("Password is required");
      ActionHelper.setCurrentPage(LoginPage);
      expect(await ActionHelper.isDisplayed("Screen")).toBe(true);
    });

    it("R1.5 - a wrong password is refused, without saying which field was wrong", async () => {
      await LoginPage.signIn("bob@example.com", "definitely-not-the-password");

      expect(await LoginPage.errorText("Generic Error")).toBe(
        "Provided credentials do not match any user in this service.",
      );
      ActionHelper.setCurrentPage(LoginPage);
      expect(await ActionHelper.isDisplayed("Screen")).toBe(true);
    });

    it("R1.6 - a locked-out account is refused, and says so distinguishably", async () => {
      await LoginPage.signIn("alice@example.com", "10203040");

      const message = await LoginPage.errorText("Generic Error");

      // The requirement is that a locked-out customer can tell they are locked out
      // rather than mistyped - i.e. this must NOT be R1.5's wording.
      expect(message).toContain("locked out");
      expect(message).not.toBe(
        "Provided credentials do not match any user in this service.",
      );

      ActionHelper.setCurrentPage(LoginPage);
      expect(await ActionHelper.isDisplayed("Screen")).toBe(true);
    });
  });

  describe("signing in and out", () => {
    /** Open the drawer's Log Out confirmation, from wherever the app is. */
    async function openLogoutDialog(): Promise<void> {
      ActionHelper.setCurrentPage(Catalog);
      await ActionHelper.click("Menu Button");
      await ActionHelper.click("Menu Log Out");
      await ActionHelper.waitForDisplayed("Dialog Message", scaled(15_000));
    }

    /**
     * Leave no dialog behind, pass or fail. Without this a failed assertion in one
     * test hands the next one a screen it cannot see past - and the second failure
     * is noise that hides the first (rule 10).
     */
    afterEach(async () => {
      ActionHelper.setCurrentPage(Catalog);
      if (await ActionHelper.isDisplayed("Dialog Cancel"))
        await ActionHelper.click("Dialog Cancel").catch(() => undefined);
    });

    it("R1.2 - valid credentials sign the customer in and return them to the catalogue", async () => {
      await openCleanForm();
      await LoginPage.signIn("bob@example.com", "10203040");

      ActionHelper.setCurrentPage(Catalog);
      await ActionHelper.waitForDisplayed("Root", scaled(30_000));
      expect(await ActionHelper.isDisplayed("Root")).toBe(true);
    });

    it("R1.7 - signing out asks for confirmation, in grammatical English", async () => {
      await openLogoutDialog();

      const message = await ActionHelper.getText("Dialog Message");
      expect(message).toContain("Are you sure");

      // ⚠️ THIS ASSERTION IS EXPECTED TO FAIL against demo app v1.3.0 - the build
      // says "Are you sure you sure you want to logout?". Filed as APP_ISSUES A1.
      // Kept RED deliberately: rule 14 - never soften an assertion to make broken
      // behaviour look fine. A person decides whether to exclude it; until then the
      // red is the signal.
      //
      // ⚠️ A PHRASE check, not a word-versus-next-word comparison. The first
      // version of this test did the latter, passed GREEN against this very
      // build, and missed the defect entirely - see utils/copy.ts.
      //
      // Asserted as a TEXT comparison rather than `repeatedPhrase(...) === null`
      // so the failure prints the sentence the app should have shown next to the
      // one it did. Identical semantics: withoutRepeatedPhrase only changes the
      // string when there is a repeat.
      expect(message).toBe(withoutRepeatedPhrase(message));
    });

    it("R1.8 - cancelling the sign-out leaves the customer signed in", async () => {
      // ⚠️ OPENS ITS OWN DIALOG. An earlier version relied on R1.7 leaving one up,
      // and when R1.7's assertion failed the framework's afterTest recovery
      // relaunched the app and dismissed it - so this failed with "button2 still
      // not displayed" and looked like a second, unrelated defect. A test that
      // depends on the previous test's leftovers reports the previous test's
      // failure twice.
      await openLogoutDialog();
      await ActionHelper.click("Dialog Cancel");

      // Cancelling must leave the session intact. The drawer shows both Log In and
      // Log Out either way, so the only discriminator this app offers is where its
      // Log In entry leads - which is what the contract's isSignedOut() asks.
      expect(await appContract.isSignedOut!()).toBe(false);
    });
  });
});
