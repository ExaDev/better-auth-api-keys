import { describe, expect, it } from "vitest";
import { peerSpecifiers } from "./peer-specifiers.ts";

const peers = { zod: "^4.0.0", "better-auth": "^1.7.5" };

describe("peerSpecifiers", () => {
  it("pins every peer to its range's floor", () => {
    expect(peerSpecifiers(peers, "floor")).toEqual([
      "zod@4.0.0",
      "better-auth@1.7.5",
    ]);
  });

  it("asks for the newest version every peer's range admits", () => {
    expect(peerSpecifiers(peers, "latest")).toEqual([
      "zod@^4.0.0",
      "better-auth@^1.7.5",
    ]);
  });

  it("refuses a range with no single floor version", () => {
    expect(() => peerSpecifiers({ zod: ">=3 <5" }, "floor")).toThrow(
      "zod's peer range >=3 <5 is not a caret range",
    );
  });
});
