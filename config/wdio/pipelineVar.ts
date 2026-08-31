/**
 * Read an env var a CI system may have left as an UNEXPANDED MACRO.
 *
 * ⚠️ AN UNSET TEMPLATED VARIABLE DOES NOT ALWAYS ARRIVE UNSET. Several CI systems
 * substitute a reference to a variable that does not exist with the literal
 * reference text rather than with nothing - so `IOS_UDID: $(IOS_UDID)` in a job
 * that never defined it arrives as the eight characters `$(IOS_UDID)`. Treating
 * that as a value is how a capability ends up pointing at a directory literally
 * named `$(WDA_DERIVED_DATA_PATH)`, and the driver's error names the missing
 * directory rather than the missing variable.
 *
 * Measured on Azure DevOps, whose `$(NAME)` does exactly this; `${NAME}` and
 * `${{ }}` are rejected too because they fail the same way. No legitimate device
 * udid or filesystem path starts with either, so the guard costs nothing elsewhere.
 *
 * Both callers are optional capabilities that a job supplies and a dev machine does
 * not, which is why "absent" and "unexpanded" have to mean the same thing here.
 */
export function pipelineVar(name: string): string | undefined {
  const value = process.env[name];
  if (!value || /^\$[({]/.test(value)) return undefined;
  return value;
}

/**
 * True inside a CI run.
 *
 * ⚠️ NOT ciExclusions.inCI(), which is deliberately falsified by
 * RUN_CI_EXCLUDED=true - see the callers in capabilities.ts. This one answers
 * "is there a hosted agent underneath us", which never stops being true.
 *
 * `TF_BUILD` is Azure DevOps'; everything else sets `CI`.
 */
export function inPipeline(): boolean {
  return Boolean(process.env.TF_BUILD || process.env.CI);
}
