import { describe, expect, it } from "vitest";
import * as z from "zod/mini";
import rawManifest from "../package.json" with { type: "json" };

const dependencyMap = z.record(z.string(), z.string());

/** The manifest fields these checks read. Every dependency field npm honours is listed, so none can smuggle in a workspace specifier unchecked. */
const manifest = z.parse(
  z.object({
    name: z.string(),
    license: z.string(),
    private: z.boolean(),
    dependencies: dependencyMap,
    devDependencies: dependencyMap,
    peerDependencies: dependencyMap,
    optionalDependencies: z.optional(dependencyMap),
  }),
  rawManifest,
);

// The package is built to move to its own repository and be published unchanged, so its manifest must already be publishable: nothing that only resolves inside this workspace.
describe("the package manifest", () => {
  it("uses no workspace: specifier in any dependency field", () => {
    const specifiers = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].flatMap((dependencies) =>
      dependencies === undefined ? [] : Object.values(dependencies),
    );
    expect(
      specifiers.filter((specifier) => specifier.startsWith("workspace:")),
    ).toEqual([]);
  });

  it("depends at runtime on zod alone", () => {
    expect(Object.keys(manifest.dependencies)).toEqual(["zod"]);
  });

  it("takes better-auth and @better-auth/core as peers with version ranges, not pins", () => {
    const peers = manifest.peerDependencies;
    expect(Object.keys(peers).sort()).toEqual([
      "@better-auth/core",
      "better-auth",
    ]);
    for (const range of Object.values(peers)) {
      expect(range).toMatch(/^\^\d+\.\d+\.\d+$/u);
    }
  });

  it("is MIT licensed and private until it is extracted", () => {
    expect(manifest.license).toBe("MIT");
    expect(manifest.private).toBe(true);
    expect(manifest.name).toBe("@exadev/better-auth-api-keys");
  });
});
