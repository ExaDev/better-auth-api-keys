import { describe, expect, it } from "vitest";
import * as z from "zod/mini";
import rawManifest from "../package.json" with { type: "json" };

const dependencyMap = z.record(z.string(), z.string());

/** The manifest fields these checks read. Every dependency field npm honours is listed, so none can smuggle in a workspace specifier unchecked. */
const manifest = z.parse(
  z.object({
    name: z.string(),
    license: z.string(),
    private: z.optional(z.boolean()),
    publishConfig: z.object({ access: z.string() }),
    dependencies: z.optional(dependencyMap),
    devDependencies: dependencyMap,
    peerDependencies: dependencyMap,
    optionalDependencies: z.optional(dependencyMap),
  }),
  rawManifest,
);

// The manifest is what npm publishes, so these hold it to what a host installing the package relies on.
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

  it("has no runtime dependencies of its own", () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  // Zod is a peer, not a dependency: the host passes its own Zod schemas for scopes and claims, and the package parses with them, so a private copy of Zod would be a second, incompatible instance of its types and runtime.
  it("takes zod, better-auth and @better-auth/core as peers with caret ranges", () => {
    const peers = manifest.peerDependencies;
    expect(Object.keys(peers).sort()).toEqual([
      "@better-auth/core",
      "better-auth",
      "zod",
    ]);
    for (const range of Object.values(peers)) {
      expect(range).toMatch(/^\^\d+\.\d+\.\d+$/u);
    }
  });

  it("develops against an exact version of every peer", () => {
    for (const name of Object.keys(manifest.peerDependencies)) {
      expect(manifest.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/u);
    }
  });

  it("is MIT licensed and published publicly", () => {
    expect(manifest.license).toBe("MIT");
    expect(manifest.private).not.toBe(true);
    expect(manifest.publishConfig.access).toBe("public");
    expect(manifest.name).toBe("@exadev/better-auth-api-keys");
  });
});
