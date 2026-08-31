/**
 * Device clipboard, via Appium's `mobile:` execute methods.
 *
 * ⚠️ Replaces `browser.setClipboard()` / `browser.getClipboard()`, which
 * WebdriverIO deprecated (2026-08-07):
 *
 *   [WEBDRIVERIO DEPRECATION NOTICE] Use `driver.execute('mobile: setClipboard', ...)`
 *
 * Verified against the drivers actually installed here rather than assumed -
 * BOTH appium-xcuitest-driver and appium-uiautomator2-driver expose
 * `mobile: setClipboard` and `mobile: getClipboard` with the same schema
 * (`content` required and base64-encoded, `contentType` optional), so one
 * cross-platform call works and no platform split is needed. XCUITest also has
 * `mobile: setPasteboard`, which is iOS-only - deliberately not used.
 *
 * The base64 wrapping is the protocol's, not ours: the endpoint carries bytes,
 * so text has to be encoded going in and decoded coming out. Wrapping it here
 * keeps that detail out of the five call sites that used to repeat it.
 *
 * This matters more than a normal deprecation would: the paste path in
 * utils/webViewInput.ts is what makes hosted-login sign-in work at all when the
 * device has a non-Latin keyboard active - see rule 18, and
 * docs/architecture/authentication.md. Keep it working on both platforms.
 */

/** Put plain text on the device clipboard. */
export async function setClipboardText(text: string): Promise<void> {
  await browser.execute("mobile: setClipboard", {
    content: Buffer.from(text, "utf8").toString("base64"),
    contentType: "plaintext",
  });
}

/** Read the device clipboard as plain text ("" when empty). */
export async function getClipboardText(): Promise<string> {
  const encoded = (await browser.execute("mobile: getClipboard", {
    contentType: "plaintext",
  })) as unknown as string;
  return encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
}
