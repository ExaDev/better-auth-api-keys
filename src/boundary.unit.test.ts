import { describe, expectTypeOf, it } from "vitest";

// This file type-checks under the package's web-only tsconfig.json, so each directive below fails the typecheck the moment a Node, Workers or Cloudflare type leaks into the package's program (through a `types` entry, or a dependency's own type references).
describe("the package's type environment", () => {
  it("has no Node, Workers or Cloudflare globals", () => {
    // @ts-expect-error Buffer is Node's; the package uses Uint8Array.
    expectTypeOf<Buffer>().not.toBeNever();
    // @ts-expect-error Env is a Worker's generated binding type, which belongs to the host.
    expectTypeOf<Env>().not.toBeNever();
    // @ts-expect-error D1Database is Cloudflare's; the package reaches storage only through its ports.
    expectTypeOf<D1Database>().not.toBeNever();
    // @ts-expect-error ExecutionContext is a Worker's; the host adapts waitUntil to `defer`.
    expectTypeOf<ExecutionContext>().not.toBeNever();
  });
});
