import type { Options } from "semantic-release";
import { commitTypes } from "./commit-types.ts";

/**
 * commit-analyzer only falls back to its default rules, which include "a breaking change is a major release", when no custom rule matches a commit. A breaking `feat` matches `feat → minor` here, so without this rule it would release as a minor version.
 */
const releaseRules = [
  { breaking: true, release: "major" },
  ...commitTypes
    .filter((entry) => entry.release !== false)
    .map((entry) => ({ type: entry.type, release: entry.release })),
];

/**
 * Runs on `main` from the Release job in .github/workflows/ci.yml. Every plugin's verifyConditions runs before anything is written, and the npm plugin's checks that the job can publish (an OIDC token exchange with npm for this package, or else an NPM_TOKEN, which the job blanks), so a run that cannot publish stops there, before the release commit, the tag or the GitHub Release exists, and the GitHub plugin's fail step opens an issue saying so, which the next successful release closes. Otherwise it bumps the version from the commits since the last tag, commits CHANGELOG.md and package.json back to main, tags, publishes to npm with trusted publishing and creates the GitHub Release.
 */
const config: Options = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      { preset: "conventionalcommits", releaseRules },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: {
          types: commitTypes.map((entry) => ({
            type: entry.type,
            section: entry.section,
          })),
        },
      },
    ],
    "@semantic-release/changelog",
    ["@semantic-release/npm", { npmPublish: true }],
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json"],
        // [skip ci]: the release commit changes only the version and changelog, which the run that made it has already checked.
        message: "chore(release): ${nextRelease.version} [skip ci]",
      },
    ],
    "@semantic-release/github",
  ],
};

export default config;
