import { defineConfig } from "eslint/config";
import { packageLintConfig } from "../../eslint.shared.ts";

/** Workspace packages and the app, which this package must never depend on: it is built to move to its own repository, so it may import only zod and better-auth. */
const workspacePackages = [
  "db",
  "contract",
  "access-policy",
  "tokens",
  "retention",
  "artifact-sources",
  "gist-sync",
  "api",
  "web",
  "gateway",
];

export default defineConfig(
  packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    isomorphic: true,
    // A barrel per folder, not only src/index.ts: each subpath export (./contract, ./core, ./testing) needs its own entry point, and ./core must not pull in better-auth through the main barrel.
    barrelPolicy: "siblings",
    additionalRestrictedImports: [
      {
        patterns: [
          {
            regex: `^(${workspacePackages.join("|")})(/.*)?$`,
            message:
              "This package is extractable: it must not import a workspace package or the app.",
          },
          {
            regex: "^(\\.\\./){2}",
            message:
              "This package is extractable: a relative import must stay inside the package's own src/.",
          },
          {
            regex: "^(cloudflare:|@cloudflare/)",
            message:
              "This package is runtime-neutral: Cloudflare modules and types belong to the host.",
          },
          {
            regex: "^drizzle-orm(/.*)?$",
            message:
              "This package reaches storage only through its ApiKeyStore port or better-auth's adapter, never an ORM directly.",
          },
        ],
      },
      {
        patterns: [
          {
            regex: "^(better-auth|@better-auth/[^/]+)(/.*)?$",
            message:
              "Only src/better-auth/ may import better-auth: the contract, core, web-crypto and testing folders stay independent of it.",
          },
        ],
        allowedIn: ["src/better-auth/**"],
      },
    ],
  }),
);
