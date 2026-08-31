/**
 * One knob for "this device is slower than a dev machine".
 *
 * Every timeout written in a spec or a page object is a dev-machine number,
 * measured against a local Simulator or emulator. A hosted CI agent is nothing
 * like that machine - the same app that draws in 2-3s locally has taken 161s from
 * process start to first frame on one.
 *
 * ⚠️ SCALE, DON'T REWRITE. Each of those numbers was measured against a real
 * failure, and the reasoning is in the comment beside it. Hard-coding CI-sized
 * numbers would throw that away and make a local run take minutes to fail; one
 * multiplier keeps the local values authoritative and the ratios intact.
 *
 * Unset - the default, i.e. local - is 1, so a dev run is bit-for-bit unchanged.
 * A CI job should set it: android 4x and ios 3x are the values the predecessor
 * project used. ⚠️ That asymmetry encodes an old belief that iOS was the fast one in
 * CI, which measurement reversed - it is kept only because the honest fix is fewer
 * round-trips, not a bigger multiplier. Measure your own. See
 * docs/architecture/performance.md and docs/guides/ci.md.
 */
export function scaled(ms: number): number {
  const raw = Number(process.env.TIMEOUT_SCALE);
  // Guard the parse rather than trusting it: an unexpanded `$(VAR)` from a
  // pipeline, an empty string or a typo all become NaN, and NaN * ms is NaN,
  // which webdriverio takes as "no timeout" - a hang instead of a failure.
  const scale = Number.isFinite(raw) && raw >= 1 ? raw : 1;
  return Math.round(ms * scale);
}

/** The current scale, for logging it once at the top of a run. */
export function timeoutScale(): number {
  return scaled(1000) / 1000;
}

/**
 * The per-test ceiling for an ordinary suite -
 * `describe(..., function () { this.timeout(suiteTimeout()) })`.
 *
 * ⚠️ A ceiling exists to catch a HANG, not to punish a slow test. Sizing it
 * generously does the opposite of what it looks like: a hung test burns the ceiling
 * before anyone finds out, and the CI job's step limit then expires with most of
 * the suite unrun. Two builds died that way at the old 900s-per-test setting.
 *
 * Sized from measurement, with margin, not from taste:
 *
 *   slowest legitimate test, local iOS      110.5s
 *   slowest legitimate test, CI iOS         335.6s   (before the round-trip work)
 *   slowest legitimate test, CI Android     115.6s
 *   this ceiling on iOS (scale 3)           540s     -> 1.6x the worst CI sample
 *
 * ⚠️ Cut it again from a real run's published JUnit results, never from a local run:
 * that 335.6s sample predates the round-trip fixes, and local and CI per-call costs
 * differ by more than an order of magnitude on iOS.
 */
export function suiteTimeout(): number {
  return scaled(180000);
}

/**
 * The ceiling for a suite whose tests drive a real end-to-end flow no amount of
 * framework work can shorten - a first-login, a password change that waits on a
 * a confirmation email, a connectivity drop and recovery - or one whose assertions run
 * against a very large tree, where each driver call costs several times the average.
 *
 * 900s on iOS, 1200s on Android. Reach for `suiteTimeout()` unless the suite
 * genuinely waits on a third party or genuinely is that heavy.
 */
export function longFlowTimeout(): number {
  return scaled(300000);
}
