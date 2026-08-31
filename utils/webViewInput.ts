import { browser } from "@wdio/globals";
import { setClipboardText } from "./clipboard";
import { scaled } from "../test/support/timeouts";

// Typing into a HOSTED LOGIN's WebView pages.
//
// ⚠️ ONLY NEEDED FOR `auth.strategy: "webview"` in config/app.ts. An app whose
// sign-in is in its own React Native views needs none of this - use setValue().
//
// Measured against Microsoft Entra / Azure AD B2C, and named for it throughout
// because the evidence is worth more than a vague noun. Auth0, Okta and Cognito
// present the same shape of problem: a form the app does not own, re-rendering
// on its own schedule, inside a WebView context Appium must switch into. If you
// are on one of those, expect the failure modes below and re-measure the numbers.
//
// Every pre-auth screen that lives in the same WebView shares this problem, so
// the workaround lives here once rather than once per page object.
//
// THE PROBLEM. B2C re-renders its form asynchronously (on blur, on validation,
// after the "Keep me signed in" checkbox is ticked), and a re-render that
// lands mid-typing resets the input - so the field keeps only the keystrokes
// that arrived after it. Measured live 2026-07-31: 1 of 8 characters, 2 of 16,
// 4 of 17, 5 of 17. It is not a delivery-speed problem in the ordinary sense -
// retrying the SAME way produces the SAME truncation every time, four attempts
// running - so the fix is to verify, and to change strategy when a retry is
// needed rather than repeat one that has already failed.
//
// AND YOU HAVE TO READ THE FIELD BACK. An empty iOS field reports its
// PLACEHOLDER as its value ("Password", "Verification Code"), so "not empty"
// proves nothing; a secure field that really holds text reads back as one
// bullet per character, so its LENGTH is checkable even though its text is
// not. Android's EditText reports its hint rather than its text, so there is
// nothing to verify against there and one write is all that can be done.

const BULLETS = /^[•·*]+$/;

export interface WebViewFieldOptions {
  /** A masked input - verified by bullet COUNT rather than by its text. */
  secure?: boolean;
  /** Named in the log line when a retry happens. */
  label?: string;
}

/**
 * PASTE a value in instead of typing it. iOS only. Returns false if it didn't take.
 *
 * Why this is the primary strategy
 * ⚠️ TYPING GOES THROUGH THE DEVICE'S ACTIVE KEYBOARD, AND PASTING DOES NOT.
 * That is the whole point, and it is what finally killed the "the login page
 * truncates the password" saga - which turned out not to be about the login page
 * at all. See config/wdio/device.ts's keyboard note.
 *
 * XCUITest types by driving the on-screen keyboard. B2C's two inputs get DIFFERENT
 * keyboards - the email input is `type="email"` so iOS forces an ASCII one, while
 * the password input gets whatever the device is currently set to - so on a device
 * with a Cyrillic layout active, every Latin LETTER typed into the password was
 * silently dropped and only the digits arrived. Every "truncation" figure the
 * predecessor project recorded is the DIGIT COUNT of the password (8 characters,
 * 1 digit -> 1 bullet).
 *
 * It is the ACTIVE layout that matters, not merely an installed one, which is why
 * this looked random: a developer switching input languages during their own work
 * changes it underneath a running suite. Measured back-to-back on one machine with
 * an identical keyboard list: one run typed 17 of 17, the next typed 2 of 17.
 *
 * Proof that paste is immune, from a single run on a device in the failing state:
 *
 *   TYPED       wrote 17 -> field held  2 bullets   ✗
 *   PASTE(menu) wrote 17 -> field held 17 bullets   ✅
 *
 * ⚠️ THE MENU ITEM IS ADDRESSED BY POSITION, NEVER BY TEXT. "Paste" is localised
 * (Ukrainian renders it "Вставити"), and localisation is the very thing being
 * worked around here - matching the English word would reintroduce the bug in a
 * new form. On an EMPTY field the menu is ["Paste", "AutoFill"], so the first item
 * is the one wanted; the read-back below is what makes that safe rather than
 * assumed, and a miss simply falls through to typing.
 *
 * The JS route would be cleaner still - switch to the WEBVIEW context and set
 * `input.value` directly - but it is NOT available: since iOS 16.4 a WKWebView must
 * opt in to being inspectable (`isInspectable = true`, react-native-webview's
 * `webviewDebuggingEnabled`). The build measured here did not, and `getContexts()`
 * returned only `["NATIVE_APP"]` however long you polled. ⚠️ CHECK `getContexts()`
 * ONCE for your own build rather than assuming either way - if the WebView IS
 * inspectable, the JS route is better than everything below it.
 */
async function pasteWebViewField(
  field: WebdriverIO.Element,
  value: string,
  holdsValue: () => Promise<boolean>,
): Promise<boolean> {
  try {
    // An empty field gives the two-item menu this relies on; a populated one gives
    // Select All / Cut / Copy / Paste and a different first item.
    //
    // ⚠️ BUT ONLY CLEAR A FIELD THAT HAS SOMETHING IN IT. On a first fill - the
    // common case, and the one that reaches here - the field is already empty, so
    // this was a no-op that still cost a driver round-trip against the one element
    // where `clear` is dangerous. All three of 2026-08-23's WebDriverAgent wedges
    // were a `clear` on a B2C field hanging for the full 240s proxy timeout; this
    // file already documents the same call as blurring the secure field and firing
    // B2C's on-blur re-render. Not making the call at all is the only fix that
    // removes the trigger rather than bounding the damage (capabilities.ts bounds
    // the damage).
    //
    // An empty iOS field reports its PLACEHOLDER as its value, so "" is not the
    // test - `value === placeholderValue` is. Degrades safely: if either read
    // fails, `alreadyEmpty` is false and the clear happens exactly as before.
    const alreadyEmpty = await (async () => {
      try {
        const current = await field.getValue();
        if (!current) return true;
        return current === (await field.getAttribute("placeholderValue"));
      } catch {
        return false;
      }
    })();
    if (!alreadyEmpty) await field.clearValue().catch(() => undefined);
    await browser.pause(300);
    await setClipboardText(value);

    await field.click();
    await browser.pause(500);

    const { x, y } = await field.getLocation();
    const { width, height } = await field.getSize();
    await browser
      .action("pointer")
      .move({ x: Math.round(x + width / 2), y: Math.round(y + height / 2) })
      .down()
      .pause(1500)
      .up()
      .perform();
    await browser.pause(1000);

    const items = [...(await browser.$$(".//XCUIElementTypeMenuItem"))];
    if (!items.length) return false;
    await items[0].click();
    await browser.pause(900);

    return await holdsValue();
  } catch {
    return false;
  } finally {
    // Don't leave a password on the device clipboard. A spec that asserts on the
    // clipboard itself should set its own sentinel first, so this cannot upset it.
    await setClipboardText("cleared").catch(() => undefined);
  }
}

export async function fillWebViewField(
  field: WebdriverIO.Element,
  value: string,
  options: WebViewFieldOptions = {},
): Promise<boolean> {
  const { secure = false, label = "field" } = options;

  if (!browser.isIOS) {
    await field.setValue(value);
    return true;
  }

  const holdsValue = async () => {
    const read = ((await field.getValue()) ?? "") as string;
    return secure
      ? BULLETS.test(read) && read.length === value.length
      : read === value;
  };

  // Read before writing.
  // ⚠️ DO NOT REMOVE: without this early return, the function can only ever rewrite
  // a field, never VERIFY one.
  //
  // A caller that fills several secure fields, dismisses the keyboard, then calls
  // this again on all of them to "re-verify" had no way to do that: the paste path
  // opens with clearValue(), so a field that was already correct got WIPED and
  // refilled.
  //
  // That is actively harmful here, not just wasteful. This very file documents
  // clearValue() as blurring the WebView's secure field, which fires the provider's
  // on-blur re-render - the mechanism behind the truncation the typing path was
  // changed to avoid. So the "verification" pass was re-rendering the page once per
  // field, and a re-render landing on a SIBLING field is exactly how the others lose
  // their values and the run reports "lost its value after the keyboard was
  // dismissed".
  //
  // Cost of the old behaviour on a healthy run: the paste path spends ~4.2s of
  // fixed pauses per field, so the second pass alone burned ~13s to redo work
  // that was already correct.
  //
  // Safe on a FIRST fill: an untouched field is empty, and an empty iOS secure
  // field reads back its PLACEHOLDER, which fails the BULLETS test - so this
  // returns false and the paste proceeds exactly as before.
  //
  // `.catch(() => false)` matters: getValue() used to be reached only from
  // inside pasteWebViewField's try/catch, so a stale or detached element was
  // swallowed. Calling it first without a guard would turn that into a throw.
  // On any read failure, fall through and fill exactly as before.
  if (await holdsValue().catch(() => false)) return true;

  // PASTE FIRST - see pasteWebViewField. It is keyboard-independent, so it works on
  // a device in any language, which typing does not.
  if (await pasteWebViewField(field, value, holdsValue)) return true;
  console.log(`[webview] "${label}": paste did not take, falling back to typing`);

  // FOUR attempts, not three: a run lost a whole pre-auth suite to "field would not
  // hold its value" after exhausting three, and a fourth costs nothing on the ~95%
  // of fills that succeed first time - the loop exits on the `holdsValue()` check at
  // the top.
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (await holdsValue()) return true;

    await field.click();
    // On-blur reflow settle - longer each time, because the whole reason a
    // retry is happening is that the page was still moving. See
    // docs/architecture/authentication.md.
    //
    // 900ms base, up from 600ms (2026-08-05). The re-render this waits out is
    // B2C's and is not pollable from here, so the only lever is to give it more
    // room; 600 was demonstrably not always enough. Only a RETRY pays this - the
    // first attempt's settle is the one that matters for speed and it is the
    // same order as before.
    await browser.pause(900 * attempt);

    if (attempt === 1) {
      // NO clearValue() here, deliberately. `setValue` already replaces the
      // field's contents, so the clear was redundant - and it is not free: this
      // WebView's secure field BLURS on clearValue (the same fact that makes
      // browser.keys type into nothing on the slow path), which fires B2C's
      // on-blur re-render, which then lands while setValue is still typing and
      // truncates it.
      //
      // Measured 2026-08-03 with the clear still in place: an 8-character password
      // held ONE bullet and a 16-character one held five, identically across every
      // attempt and every relaunch - the exact signature the docs attribute to
      // filling email before password, on code that already fills password first.
      // It failed EVERY time, which is what made it findable at all. Removing it
      // took sign-in to first-time success on three consecutive runs.
      //
      // ⚠️ RE-READ THIS BEFORE TRUSTING THE FIGURES ABOVE. The truncation the whole
      // file works around turned out to be the device's non-Latin KEYBOARD, not the
      // provider's re-render - every figure quoted here is the DIGIT COUNT of the
      // password. See docs/history/experiments.md.
      //
      // The escalation below is therefore defence in depth, not a proven fix; a
      // later run still truncated a 16-character password to two bullets, and the
      // escalation plus the caller's relaunch loop are what cover that. What
      // removing the clear did fix was a self-inflicted trigger that made the race
      // fire on every single attempt.
      await field.setValue(value);
    } else {
      // The slow paths APPEND, so they do need the field emptied first.
      await field.clearValue().catch(() => {
        /* already empty, or the field refuses clear - write over it anyway */
      });
      // addValue, NOT browser.keys. `clearValue()` blurs this WebView's secure
      // field, so keys() then types into nothing and the slow path fails
      // exactly like the fast one - which is what made the first version of
      // this look like "slower typing doesn't help" (measured 2026-07-31:
      // three characters of sixteen, identically, across eighteen attempts).
      // addValue targets the element, so it re-focuses it on every character.
      for (const character of value.split("")) {
        await field.addValue(character);
        await browser.pause(attempt === 2 ? 120 : 250);
      }
    }

    try {
      await browser.waitUntil(holdsValue, { timeout: scaled(3000), interval: 200 });
      return true;
    } catch {
      console.log(`[webview] "${label}": did not hold its value, retry ${attempt}/4`);
    }
  }
  return holdsValue();
}
