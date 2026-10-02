import type { PartialStrykerOptions } from "@stryker-mutator/api/core";

/** Derived by the rule below from the mutation workflow run it was set from: a score of 88.67 floors to 88, and 14 timeouts among 309 valid mutants are a 4.53-point share, which rounds up to a margin of 5. */
const MUTATION_BREAK_THRESHOLD = 83;

// Deliberately no `incremental`/`incrementalFile`: @stryker-mutator/vitest-runner reports no test-location support, so per StrykerJS's documented incremental-mode limitations Stryker cannot notice that a test file changed, and would reuse a stale cached verdict for every mutant that test used to cover.
const config: PartialStrykerOptions = {
  packageManager: "pnpm",
  testRunner: "vitest",
  // Explicit, not Stryker's own plugin auto-discovery: that resolves `@stryker-mutator/*` plugins relative to wherever `@stryker-mutator/core` itself lives, which under pnpm's isolated node_modules is a separate virtual-store entry with no sibling plugins in it. An explicit list resolves from this config's own location instead.
  plugins: [
    "@stryker-mutator/typescript-checker",
    "@stryker-mutator/vitest-runner",
  ],
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/test-support/**"],
  reporters: ["html", "json", "clear-text", "progress"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // high and low only colour the report. break is derived, never picked, by the rule documents.js sets out for its packages: take a full run's mutation score, floor it to whole points, and subtract a noise margin of the run's Timeout-classified share of its valid mutants (killed, timed out, survived and uncovered), rounded up to whole points with a floor of one. Timeout is the one classification that flaps between runs, since runner load alone decides whether a mutant times out (detected) or survives, so the margin keeps every timeout re-classifying from tripping the break, while a drop beyond it is a real regression. Re-derive it from the mutation workflow's report whenever the tests or the source change the score.
  thresholds: { high: 90, low: 70, break: MUTATION_BREAK_THRESHOLD },
};

export default config;
