import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // test/ holds the unit tests that need Node (the manifest and lint-boundary checks), which src/'s web-only tsconfig can't type.
          include: ["src/**/*.unit.test.ts", "test/*.unit.test.ts"],
        },
      },
    ],
  },
});
