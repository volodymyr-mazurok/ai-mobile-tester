/**
 * The three things the FRAMEWORK needs to know how to ask YOUR app.
 *
 * Everything else about your app lives in page objects that only your specs
 * call. These three are different: the framework itself calls them, from the
 * recovery paths that run when a spec has already gone wrong (see session.ts).
 * They are the seam between generic recovery logic and one specific app.
 *
 * Implement them once, in test/pageobjects/app.contract.ts.
 *
 * ⚠️ Keep every method here CHEAP and TOTAL. They are called when the app is in
 * an unknown state - mid-modal, mid-flow, freshly reinstalled, or showing a
 * permission dialog. A method that assumes a particular screen will hang for
 * its whole timeout and turn a recoverable failure into a dead suite.
 */
export interface AppContract {
  /**
   * Resolve once the app has reached ANY state a test could work from.
   *
   * For an app with sign-in that means "the signed-in home OR the sign-in
   * form" - both are legitimate resting places and the caller decides which it
   * wanted. Reject if neither appears.
   */
  waitForAppReady(): Promise<void>;

  /**
   * True when the app is sitting on its signed-out entry point.
   * Omit for `auth.strategy: "none"`.
   */
  isSignedOut?(): Promise<boolean>;

  /**
   * Best-effort in-app sign-out. May reject or no-op; callers always follow it
   * with a check rather than trusting it.
   * Omit for `auth.strategy: "none"`.
   */
  logout?(): Promise<void>;
}

/**
 * Your app's implementation. This is a STATIC import on purpose - the compiler
 * tells you the moment the contract and the app disagree, rather than a run
 * failing 40 minutes in.
 */
export { default as appContract } from "../pageobjects/app.contract";
