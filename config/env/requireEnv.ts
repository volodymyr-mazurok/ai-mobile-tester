/**
 * Secrets come from the ENVIRONMENT, not the source tree.
 *
 * ⚠️ THIS RULE IS NOT DECORATIVE. The repo this framework was extracted from
 * hardcoded four identity-provider client secrets and a database password in
 * committed TypeScript. They were moved to .env later - but git keeps history,
 * so every one of them had to be rotated, and the repo could not be shared
 * until it was re-created without its history. Cost: a day, and five rotations.
 *
 * A CI checkout makes it worse. Most systems clone in FULL by default, so every
 * historical value of a hardcoded secret lands on the agent's disk. Read from the
 * environment instead and they arrive masked, in the process env of the step that
 * needs them, and are never written to the workspace. Check out shallow as well -
 * see docs/guides/ci.md.
 *
 * Where the values come from:
 *   locally  .env (gitignored; copy .env.example and fill it in)
 *   in CI    a secret variable group / repository secrets
 */

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      [
        `Missing required environment variable: ${name}`,
        "",
        "  Locally: copy .env.example to .env and fill it in.",
        "  In CI:   it comes from the job's secret store - and on most CI systems a",
        "           SECRET is NOT mapped into a script automatically. It has to be",
        "           listed explicitly in the step's env block, or it arrives",
        "           undefined and you land here. See docs/guides/ci.md.",
      ].join("\n"),
    );
  }
  return value;
}
