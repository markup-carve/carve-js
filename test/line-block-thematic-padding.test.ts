import { describe, expect, it } from "vitest";
import { carveToCarve, carveToHtml } from "../src/index.js";

const bodies = [
  "---",
  "----",
  "-----",
  "------",
  "-------",
  "--------",
  "---------",
  "---\nnext",
  "first\n---",
  "first\n---\nlast",
  "---\n\n---",
  " ---",
  "\t---",
  "---  ",
  "\\---",
  "---\\",
  "***",
  "___",
];

describe("line-block thematic-looking text", () => {
  it("keeps the smart dash without a protective space or escape", () => {
    const formatted = carveToCarve("::: |\n---\n");
    expect(formatted).toBe("::: |\n---\n:::\n");
    expect(carveToHtml(formatted)).toBe(
      '<div class="line-block">\n  <p>—</p>\n</div>',
    );
  });

  for (const body of bodies) {
    const block = `::: |\n${body}\n:::\n`;
    const sources = [
      block,
      `::: |\n${body}\n`,
      block
        .trimEnd()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n") + "\n",
      "- item\n\n" +
        block
          .trimEnd()
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n") +
        "\n",
    ];
    for (const source of sources) {
      it(`preserves layout and settles: ${JSON.stringify(source)}`, () => {
        const formatted = carveToCarve(source);
        expect(carveToHtml(formatted)).toBe(carveToHtml(source));
        expect(carveToCarve(formatted)).toBe(formatted);
      });
    }
  }

  it("still guards ordinary paragraphs and preserves actual thematic breaks", () => {
    for (const source of [" ---\n", "---\n"]) {
      expect(carveToCarve(source)).toBe(source);
    }
  });
});
