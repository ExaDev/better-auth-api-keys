import type { Configuration } from "lint-staged";

/** `eslint --fix` over the staged files only, never the whole tree, which would also rewrite unstaged hunks in a partially staged file. */
const config: Configuration = {
  "*.{ts,js,mjs,cjs,json,jsonc,md,yml,yaml}": "eslint --fix --cache",
};

export default config;
