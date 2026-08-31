import * as actions from "../../utils/actions";
import { dismissKeyboard } from "../../utils/gestures";
import { byTestId, Component } from "./abstraction/component";
import MobilePage from "./page";
import { scaled } from "../support/timeouts";

/**
 * The Login screen.
 *
 * ⚠️ DECLARED FLAT, because the app is flat. Verified on a live capture:
 *
 *   login screen
 *     container header
 *     Username input field
 *     Username-error-message      ← a SIBLING of the input, not a child
 *     Password input field
 *     Password-error-message      ← likewise
 *     generic-error-message
 *       "Sorry, this user has been locked out."
 *     Login button
 *     bob@example.com-autofill
 *     alice@example.com (locked out)-autofill
 *
 * Nesting the error under its input would read better and find NOTHING - the
 * lookup is scoped inside the parent's element (THE ONE RULE) and the error is
 * not in there. This is the single most common way a page object goes wrong.
 *
 * ⚠️ The header controls (`open menu`, `cart badge`) are siblings of
 * `login screen`, not children of it - they sit outside the screen container.
 */

/** An error line. The container carries the id; the message is a child TextView. */
class ErrorMessage extends Component {
  constructor(alias: string, testId: string) {
    super({ alias, selector: byTestId(testId) });
    // No id of its own, so a raw platform locator - the escape hatch byTestId's
    // docblock describes. Nested because the capture really does nest it.
    this.defineComponent({
      alias: "Text",
      selector: { ios: ".//*", android: ".//android.widget.TextView" },
    });
  }
}

class LoginPage extends MobilePage {
  constructor() {
    super("Login");

    this.defineComponent({ alias: "Screen", selector: byTestId("login screen") });
    this.defineComponent({ alias: "Menu Button", selector: byTestId("open menu") });

    this.defineComponent({ alias: "Username", selector: byTestId("Username input field") });
    this.defineComponent({ alias: "Password", selector: byTestId("Password input field") });
    this.defineComponent({ alias: "Login Button", selector: byTestId("Login button") });

    this.defineComponent(new ErrorMessage("Username Error", "Username-error-message"));
    this.defineComponent(new ErrorMessage("Password Error", "Password-error-message"));
    this.defineComponent(new ErrorMessage("Generic Error", "generic-error-message"));

    this.defineComponent({ alias: "Autofill Bob", selector: byTestId("bob@example.com-autofill") });
    this.defineComponent({
      alias: "Autofill Alice",
      selector: byTestId("alice@example.com (locked out)-autofill"),
    });
  }

  /**
   * Fill both fields and submit.
   *
   * ⚠️ Calls `utils/actions` DIRECTLY rather than going back through
   * ActionHelper - a page object's own flow method doing that would be a
   * dependency cycle. See utils/actionHelper.ts.
   *
   * ⚠️ `setValue` is correct HERE because these are the app's own React Native
   * inputs (`auth.strategy: "in-app"`). Rule 18 - never setValue into a hosted
   * login's WebView fields - does not apply to this app and must not be
   * "simplified" away in one that it does.
   */
  async signIn(username: string, password: string): Promise<void> {
    if (username) await actions.setValue(this, "Username", username);
    if (password) await actions.setValue(this, "Password", password);
    await dismissKeyboard();
    await actions.click(this, "Login Button");
  }

  /** Submit whatever is currently in the fields. */
  async submit(): Promise<void> {
    await dismissKeyboard();
    await actions.click(this, "Login Button");
  }

  /** Wait for the form itself, not merely for the app. */
  async waitForForm(): Promise<void> {
    await actions.waitForDisplayed(this, "Login Button", scaled(30_000));
  }

  /**
   * The text of one error line, or "" when that line is not showing.
   *
   * ⚠️ Reads the CHILD TextView, not the container. On Android a ViewGroup's own
   * text is empty, so asking the container returns "" whether the error is
   * absent or present - which would make every one of these assertions pass for
   * the wrong reason.
   */
  async errorText(which: "Username Error" | "Password Error" | "Generic Error"): Promise<string> {
    if (!(await actions.isExisting(this, `${which} > Text`))) return "";
    return actions.getText(this, `${which} > Text`);
  }
}

export default new LoginPage();
