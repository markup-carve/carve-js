import { describe, expect, it } from "vitest";
import { carveToAstJson, carveToCarve } from "../src/index.js";

function commentContents(source: string): string[] {
  const contents: string[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === "object") {
      const node = value as Record<string, unknown>;
      if (node.type === "comment") contents.push(node.value as string);
      Object.values(node).forEach(visit);
    }
  }
  visit(carveToAstJson(source));
  return contents;
}

// Three readers parse a `%%` line comment - the block opener, the inline
// trailing form, and a verse line - and they can drift apart. Each case runs
// through all three.
const readers: Array<[string, (line: string) => string]> = [
  ["block", (line) => `${line}\n`],
  ["inline", (line) => `p ${line}\n`],
  ["verse", (line) => `::: |\na\n${line}\nb\n:::\n`],
];

describe("a line comment's separator", () => {
  for (const [name, wrap] of readers) {
    describe(name, () => {
      it("consumes exactly one space, leaving a tab as content", () => {
        expect(commentContents(wrap("%%  x"))).toEqual([" x"]);
        expect(commentContents(wrap("%%\t x"))).toEqual(["\t x"]);
        expect(commentContents(wrap("%%x"))).toEqual(["x"]);
      });

      it("does not take a no-break space as the separator", () => {
        expect(commentContents(wrap("%% x"))).toEqual([" x"]);
      });

      it("drops the trailing space and tab run and keeps a no-break space", () => {
        expect(commentContents(wrap("%%  x \t "))).toEqual([" x"]);
        expect(commentContents(wrap("%% x  "))).toEqual(["x "]);
      });

      it("writes a form that reads back to the same content", () => {
        for (const line of ["%%  x", "%%\t x", "%% x", "%%  x \t ", "%% x  "]) {
          const written = carveToCarve(wrap(line));
          expect(carveToCarve(written)).toBe(written);
          expect(commentContents(written)).toEqual(commentContents(wrap(line)));
        }
      });
    });
  }
});
