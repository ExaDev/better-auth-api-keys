import { defineConfig } from "tsdown";
import manifest from "./package.json" with { type: "json" };

/** Every built module the exports map publishes, from its `import` path: `./dist/<folder>/index.js` is built from `src/<folder>/index.ts`, so the entries can never drift from what package.json exports. */
const entry = Object.fromEntries(
  Object.values(manifest.exports).flatMap((target) => {
    if (typeof target === "string") return [];
    const name = target.import.replace(/^\.\/dist\/(.+)\.js$/u, "$1");

    return [[name, `src/${name}.ts`]];
  }),
);

export default defineConfig({
  entry,
  // ESM only: every runtime the package targets (Workers, browsers, Node 22 and later) imports ESM, and a CommonJS build would give each entry a second copy of its module state.
  format: ["esm"],
  // The package runs unchanged in a Worker, a browser or Node, so the build assumes none of them.
  platform: "neutral",
  dts: true,
  // Follow package.json's "type": "module" for extensions (.js, .d.ts) rather than tsdown's fixed .mjs/.d.mts, so the output matches the exports map.
  fixedExtension: false,
  clean: true,
  deps: {
    // Nothing from node_modules is bundled: the build fails if a dependency would be.
    onlyBundle: [],
    // The output imports nothing but the peers, which are the host's own copies: the host's Zod schemas are parsed by the same Zod they were built with, and the plugin sees the host's better-auth.
    onlyImport: Object.keys(manifest.peerDependencies),
  },
});
