import { browser } from "@wdio/globals";

/**
 * The window size, fetched ONCE per session.
 *
 * ⚠️ IT WAS A DRIVER ROUND-TRIP PER SWIPE, and round-trips are the currency this
 * framework's CI cost is denominated in: ~50ms on a dev machine, but the hosted
 * agents are far slower and a scroll ladder can be 30 swipes deep, so a figure
 * that never changes was being re-fetched 30 times to do one scroll. Nothing here
 * rotates the device or resizes the window, and a relaunch does not change the
 * screen - so the first answer is the only answer.
 *
 * Reset by `forgetWindowSize()` if a test ever does change orientation.
 */
let cachedWindowSize: { width: number; height: number } | undefined;

export async function windowSize(): Promise<{ width: number; height: number }> {
  cachedWindowSize ??= await browser.getWindowSize();
  return cachedWindowSize;
}

/** Drop the cached window size - only needed if the orientation changes. */
export function forgetWindowSize(): void {
  cachedWindowSize = undefined;
}

/**
 * Swipe the whole screen. `mobile: scroll` (iOS) and `mobile: scrollGesture`
 * (Android) are NOT interchangeable - UiAutomator2's `mobile: scroll` is a
 * scroll-TO-element command and throws without a target selector, so the
 * directional command differs per platform. See docs/architecture/waits.md.
 *
 * Page-independent, so it lives here rather than on a page object.
 *
 * This is the BLIND version - it swipes `times` regardless of what's on
 * screen, and every swipe costs its own settle. Reach for
 * actions.scrollUntilDisplayed() instead whenever there's a specific element
 * you're scrolling to; use this only for a deliberate nudge past the fold.
 */
export async function scroll(direction: "up" | "down", times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    if (browser.isIOS) {
      await browser.execute("mobile: scroll", { direction });
    } else {
      const { width, height } = await windowSize();
      await browser.execute("mobile: scrollGesture", {
        left: Math.round(width * 0.1),
        top: Math.round(height * 0.2),
        width: Math.round(width * 0.8),
        height: Math.round(height * 0.6),
        direction,
        percent: 1.0,
      });
    }
    await browser.pause(800);
  }
}

/**
 * Put the on-screen keyboard away, if one is up.
 *
 * Page-independent, and best-effort by design: XCUITest throws outright when
 * asked to hide a keyboard that isn't there, and both drivers can refuse for a
 * field type they don't know how to dismiss. Neither is worth failing a test
 * over - but leaving the keyboard up IS, because the next tap gets spent
 * dismissing it instead of hitting what it aimed at (React Native's default
 * `keyboardShouldPersistTaps="never"`), which reads as "the button did
 * nothing". Measured live on a list screen.
 */
export async function dismissKeyboard(): Promise<void> {
  try {
    if (!(await browser.isKeyboardShown())) return;
  } catch {
    return;
  }

  try {
    if (browser.isIOS) {
      // ⚠️ DO NOT call browser.hideKeyboard() here. XCUITest answers "Did not
      // know how to dismiss the keyboard. Try to dismiss it in the way
      // supported by your application under test." for most React Native
      // inputs - there is no Done/Return key it recognises - and
      // on one run it took WebDriverAgent down with it (socket hang up, then
      // ECONNREFUSED on :8100 for the rest of the session). Tapping outside
      // the field is what a user does, it always works, and it is also the
      // tap RN would have eaten anyway - so spend it deliberately.
      //
      // 12% down the screen is the header strip on every screen this is used
      // on: a title, never a control.
      const { width, height } = await windowSize();
      await browser
        .action("pointer")
        .move({ x: Math.round(width / 2), y: Math.round(height * 0.12) })
        .down()
        .up()
        .perform();
    } else {
      await browser.hideKeyboard();
    }
  } catch {
    /* out of options - the caller's own wait is the backstop */
  }
  await browser.pause(600);
}

export default scroll;
