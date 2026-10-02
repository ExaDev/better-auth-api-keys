/**
 * The single source of truth for which Conventional Commit types this repository accepts, and which release level (if any) each one triggers. Both `commitlint.config.ts` and `release.config.ts` import this file so a commit type can never trigger a release without also passing commit-message validation, or the reverse. One definition, not two that could drift apart.
 */
export interface CommitTypeDefinition {
  readonly type: string;
  readonly section: string;
  readonly release: "patch" | "minor" | false;
}

export const commitTypes: readonly CommitTypeDefinition[] = [
  { type: "feat", section: "Features", release: "minor" },
  { type: "fix", section: "Bug Fixes", release: "patch" },
  { type: "perf", section: "Performance Improvements", release: "patch" },
  { type: "revert", section: "Reverts", release: "patch" },
  { type: "docs", section: "Documentation", release: false },
  { type: "style", section: "Styles", release: false },
  { type: "refactor", section: "Code Refactoring", release: false },
  { type: "test", section: "Tests", release: false },
  { type: "build", section: "Build System", release: false },
  { type: "ci", section: "Continuous Integration", release: false },
  { type: "chore", section: "Chores", release: false },
];

export const commitTypeNames: readonly string[] = commitTypes.map(
  (entry) => entry.type,
);
