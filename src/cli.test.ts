import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("package.json", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

  it("has correct package name", () => {
    expect(pkg.name).toBe("@0xtiby/toby");
  });

  it("has bin entry pointing to dist/cli.js", () => {
    expect(pkg.bin.toby).toBe("./dist/cli.js");
  });

  it("includes dist and prompts in files", () => {
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("prompts");
  });
});
