import { describe, expect, it } from "vitest";
import { aliasLegs, parseAliases, releaseIdentity } from "./alias-plan.ts";

const release = { name: "@scope/primary", version: "1.2.3" };

describe("parseAliases", () => {
  it("reads a list of distinct names", () => {
    expect(parseAliases(["first", "second"])).toEqual(["first", "second"]);
  });

  it("refuses an empty list", () => {
    expect(() => parseAliases([])).toThrow("must be a non-empty array");
  });

  it("refuses something other than a list", () => {
    expect(() => parseAliases({ aliases: ["first"] })).toThrow(
      "must be a non-empty array",
    );
  });

  it("refuses an entry that is not a name", () => {
    expect(() => parseAliases(["first", ""])).toThrow(
      'holds "", which is not an npm name',
    );
    expect(() => parseAliases(["first", 2])).toThrow(
      "holds 2, which is not an npm name",
    );
  });

  it("refuses a name listed twice", () => {
    expect(() => parseAliases(["first", "second", "first"])).toThrow(
      "lists first more than once",
    );
  });
});

describe("releaseIdentity", () => {
  it("reads the name and version", () => {
    expect(
      releaseIdentity({
        name: "@scope/primary",
        version: "1.2.3",
        type: "module",
      }),
    ).toEqual(release);
  });

  it("refuses a manifest without a string name or version", () => {
    expect(() => releaseIdentity({ name: "@scope/primary" })).toThrow(
      "declares no string name and version",
    );
    expect(() =>
      releaseIdentity({ name: "@scope/primary", version: 1 }),
    ).toThrow("declares no string name and version");
    expect(() => releaseIdentity(null)).toThrow(
      "declares no string name and version",
    );
  });
});

describe("aliasLegs", () => {
  it("gives every alias a leg publishing the tagged release", () => {
    expect(aliasLegs(["first", "second"], release, "v1.2.3")).toEqual([
      {
        alias: "first",
        primary: "@scope/primary",
        version: "1.2.3",
        tag: "v1.2.3",
      },
      {
        alias: "second",
        primary: "@scope/primary",
        version: "1.2.3",
        tag: "v1.2.3",
      },
    ]);
  });

  it("refuses an alias that is the primary package itself", () => {
    expect(() =>
      aliasLegs(["first", "@scope/primary"], release, "v1.2.3"),
    ).toThrow("lists @scope/primary, the primary package's own name");
  });
});
