import { describe, expect, it } from "vitest";
import { carveToAstJson, carveToCarve } from "../src/index.js";

function blockCommentContents(source: string): string[] {
  const contents: string[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === "object") {
      const node = value as Record<string, unknown>;
      if (node.type === "comment" && node.block === true)
        contents.push(node.content as string);
      Object.values(node).forEach(visit);
    }
  }
  visit(carveToAstJson(source));
  return contents;
}

describe("block comment body", () => {
  // The `%%` line form's text is a content line and loses its trailing run
  // (test/a-line-comment-drops-trailing-layout-whitespace.test.ts). A `%%%`
  // body is verbatim payload, so the same trim must not reach it.
  it("keeps a trailing space at top level, in a container, and behind a quote prefix", () => {
    expect(blockCommentContents("%%%\nbody \n%%%\n")).toEqual(["body "]);
    expect(blockCommentContents(":::\n%%%\nbody \n%%%\n:::\n")).toEqual([
      "body ",
    ]);
    expect(blockCommentContents("> %%%\n> body \n> %%%\n")).toEqual(["body "]);
  });

  it("keeps a trailing tab and a run of both", () => {
    expect(blockCommentContents("%%%\nbody\t\n%%%\n")).toEqual(["body\t"]);
    expect(blockCommentContents("%%%\nbody \t \n%%%\n")).toEqual(["body \t "]);
  });

  it("keeps the bytes through the canonical writer", () => {
    const written = carveToCarve("%%%\nbody \n%%%\n");
    expect(written).toBe("%%%\nbody \n%%%\n");
    expect(blockCommentContents(written)).toEqual(["body "]);
  });
});
