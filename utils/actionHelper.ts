import { Component } from "../test/pageobjects/abstraction/component";
import * as actions from "./actions";
import { dismissKeyboard, scroll } from "./gestures";

/**
 * The one API a spec uses. Point it at a page, then address elements by their
 * path within that page:
 *
 *   ActionHelper.setCurrentPage(Settings);
 *   await ActionHelper.getText("Account Section > Email");
 *   await ActionHelper.click("Notifications Section > #Weekly in Toggles");
 *
 * The actions themselves live in utils/actions.ts so they exist exactly once -
 * a page object's own flow method (a LoginPage's `signIn`) calls them directly
 * rather than coming back through here, which would be a dependency cycle.
 */
export default class ActionHelper {
  private static page: Component | null = null;

  public static setCurrentPage(page: Component): void {
    this.page = page;
  }

  private static current(): Component {
    if (!this.page)
      throw new Error(
        "No current page - call ActionHelper.setCurrentPage(SomePage) before " +
          "resolving a path through it.",
      );
    return this.page;
  }

  public static click(path: string) {
    return actions.click(this.current(), path);
  }

  /** Press and hold - see utils/actions.ts. */
  public static longPress(path: string, ms?: number) {
    return actions.longPress(this.current(), path, ms);
  }

  public static setValue(path: string, value: string) {
    return actions.setValue(this.current(), path, value);
  }

  /**
   * Empty an input. ⚠️ IN-APP FIELDS ONLY - see the note in utils/actions.ts.
   * `clearValue` blurs the field, and on a hosted login's pages that fires an
   * on-blur re-render mid-type; `utils/webViewInput.ts` owns those.
   */
  public static clearValue(path: string) {
    return actions.clearValue(this.current(), path);
  }

  public static getText(path: string) {
    return actions.getText(this.current(), path);
  }

  public static getValue(path: string) {
    return actions.getValue(this.current(), path);
  }

  /** A raw platform attribute - see utils/actions.ts. */
  public static getAttribute(path: string, name: string) {
    return actions.getAttribute(this.current(), path, name);
  }

  public static isDisplayed(path: string) {
    return actions.isDisplayed(this.current(), path);
  }

  public static isExisting(path: string) {
    return actions.isExisting(this.current(), path);
  }

  public static isSelected(path: string) {
    return actions.isSelected(this.current(), path);
  }

  /** Whether the element accepts interaction - see utils/actions.ts. */
  public static isEnabled(path: string) {
    return actions.isEnabled(this.current(), path);
  }

  /** State of a CUSTOM (non-native) checkbox - see utils/actions.ts. */
  public static isChecked(path: string) {
    return actions.isChecked(this.current(), path);
  }

  /** Wait for a preference checkbox to reach `state`; returns what it settled on. */
  public static waitForChecked(path: string, state: boolean, timeout?: number) {
    return actions.waitForChecked(this.current(), path, state, timeout);
  }

  public static waitForDisplayed(path: string, timeout?: number) {
    return actions.waitForDisplayed(this.current(), path, timeout);
  }

  /**
   * Wait for an element to EXIST - see actions.waitForExisting for why this is a
   * first-class helper and not a `waitUntil(isExisting)` written out per site.
   */
  public static waitForExisting(path: string, timeout?: number, timeoutMsg?: string) {
    return actions.waitForExisting(this.current(), path, timeout, timeoutMsg);
  }

  public static getCount(path: string) {
    return actions.getCount(this.current(), path);
  }

  /**
   * Every member's text, in ONE round-trip where the selector allows it.
   *
   * ⚠️ USE THIS RATHER THAN LOOPING getText() OVER findAll() - see the note on
   * `getTexts` in utils/actions.ts. That loop is a round-trip per member, which
   * is ~50ms locally and ~3s on a hosted CI agent - and it is what took one iOS
   * CI run past its 140-minute step ceiling on 3 of 9 suites.
   */
  public static getTexts(path: string) {
    return actions.getTexts(this.current(), path);
  }

  /** Every member's runtime testID - what a walked count deduplicates on. */
  public static getIds(path: string) {
    return actions.getIds(this.current(), path);
  }

  /** Wait for a collection's rows to arrive - see utils/actions.ts. */
  public static waitForCount(path: string, min = 1, timeout?: number) {
    return actions.waitForCount(this.current(), path, min, timeout);
  }

  public static getBoundingBox(path: string) {
    return actions.getBoundingBox(this.current(), path);
  }

  /** Every element a collection path matches, as raw elements. */
  public static findAll(path: string) {
    return this.current().findAll(path);
  }

  /**
   * Blind swipe, page-independent; see utils/gestures.ts. Prefer
   * scrollUntilDisplayed() when there's a specific thing you're scrolling TO -
   * it stops as soon as the target shows instead of always paying `times`.
   */
  public static scroll(direction: "up" | "down", times = 2): Promise<void> {
    return scroll(direction, times);
  }

  /**
   * Put the keyboard away, page-independent; see utils/gestures.ts. Call it
   * after typing and before tapping anything else - React Native spends the
   * first tap outside a focused input on dismissing the keyboard.
   */
  public static dismissKeyboard(): Promise<void> {
    return dismissKeyboard();
  }

  /** Swipe only until `path` is on screen - see utils/actions.ts. */
  public static scrollUntilDisplayed(
    path: string,
    direction: "up" | "down",
    maxSwipes?: number,
  ) {
    return actions.scrollUntilDisplayed(this.current(), path, direction, maxSwipes);
  }
}
