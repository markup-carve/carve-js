import { describe, expect, it } from "vitest";
import { parse } from "../src/index.js";
import { fromAstJson, toAstJson } from "../src/ast-json.js";
import { WIRE_FIELDS } from "../src/wire-fields.js";

/**
 * PART 12 section 11: a property the schema does not name is REFUSED on ingest.
 *
 * The codec copied a wire record wholesale, so any property a payload invented
 * survived a round trip - which made this engine re-publish a tree its own
 * schema rejects, since every node is `additionalProperties: false`. Measured
 * before the fix: 29 of 31 injected properties came back (carve-js#709).
 */

const SOURCE = [
  "# Heading",
  "",
  "text with *emphasis* and a [link](/u)",
  "",
  "- item",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "see[^a]",
  "",
  "[^a]: note",
  "",
].join("\n");

function walk(
  node: unknown,
  visit: (node: Record<string, unknown>) => void,
): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (typeof record.type === "string") visit(record);
  for (const value of Object.values(record)) walk(value, visit);
}

describe("an unknown wire property is refused on ingest", () => {
  it("refuses every node kind the document holds", () => {
    const published = toAstJson(parse(SOURCE));
    const typed: string[] = [];
    walk(published, (node) => typed.push(node.type as string));
    // The control on the FIXTURE: a document that grew only one node kind
    // would make the sweep below look thorough while proving one case.
    expect(new Set(typed).size).toBeGreaterThan(6);

    for (let i = 0; i < typed.length; i += 1) {
      const payload = JSON.parse(JSON.stringify(published));
      let seen = 0;
      walk(payload, (node) => {
        if (seen === i) node.bogusXyz = "leak";
        seen += 1;
      });
      expect(() => fromAstJson(payload)).toThrow(/bogusXyz/);
    }
  });

  it("names the property and where it sat", () => {
    const payload = JSON.parse(JSON.stringify(toAstJson(parse("# Heading\n"))));
    payload.children[0].bogusXyz = "leak";

    expect(() => fromAstJson(payload)).toThrow(/children\[0\]/);
  });

  it("refuses a stray key on the objects that hang off a node", () => {
    const payload = JSON.parse(JSON.stringify(toAstJson(parse("# Heading\n"))));
    payload.children[0].attrs = { id: "x", bogusXyz: "leak" };

    expect(() => fromAstJson(payload)).toThrow(/bogusXyz/);
  });

  it("still round-trips a tree this engine published", () => {
    // The control. Every assertion above passes for a decoder that refuses
    // EVERYTHING, and PART 12 section 6 is what such a decoder would break.
    const doc = parse(SOURCE);

    expect(fromAstJson(toAstJson(doc))).toEqual(doc);
  });

  it("still reads the legacy footnote id, which the decoder maps to a named field", () => {
    // §11 refuses what an ingest cannot understand; this one it understands
    // exactly. `id` is what this engine published before PART 12 §7 settled on
    // `label`, and those trees are stored. Refusing them would not protect
    // anyone from a half-read tree - it would take away the only reader that
    // reads them whole.
    const payload = {
      type: "document",
      srcByteLength: 0,
      children: [
        { type: "paragraph", children: [{ type: "text", value: "x" }] },
        {
          type: "footnote",
          id: "a",
          children: [{ type: "paragraph", children: [] }],
        },
      ],
    };

    expect(() => fromAstJson(payload as never)).not.toThrow();
  });

  it("does not let the alias in on a type that never had it", () => {
    // The boundary: the carve-out is one entry, not an escape hatch.
    const payload = {
      type: "document",
      srcByteLength: 0,
      children: [{ type: "paragraph", id: "a", children: [] }],
    };

    expect(() => fromAstJson(payload as never)).toThrow(/"id"/);
  });

  it("names a field set for every type the schema pins", () => {
    // Guards the generated map against being empty or half-built: a lookup
    // that finds no entry has to fall through somewhere, and a silent
    // fall-through is the bug this whole file is about.
    expect(Object.keys(WIRE_FIELDS).length).toBeGreaterThan(50);
    for (const [type, fields] of Object.entries(WIRE_FIELDS)) {
      expect(fields, type).toContain("type");
    }
  });
});
