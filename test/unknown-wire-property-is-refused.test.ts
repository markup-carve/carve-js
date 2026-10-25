import { describe, expect, it } from "vitest";
import { parse } from "../src/index.js";
import { fromAstJson, toAstJson } from "../src/ast-json.js";
import { WIRE_FIELDS } from "../src/ast/wire-fields.js";

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

  it("refuses an id on a footnote like any other unnamed field", () => {
    // There is no field-name alias table any more. `id` is what this engine and
    // carve-php published before PART 12 §7 settled on `label`; carve-php
    // refused it and this engine took it, so the same payload decoded in two
    // engines and failed in the third - the interchange break §3 exists against
    // (carve-js#907, carve#743).
    const withField = (field: string) => ({
      type: "document",
      astVersion: "2.0",
      stages: ["blockImagePromotion", "referenceResolution", "tableAlignment"],
      srcByteLength: 0,
      children: [
        { type: "paragraph", children: [{ type: "text", value: "x" }] },
        {
          type: "footnote",
          namespace: "footnote",
          [field]: "a",
          children: [{ type: "paragraph", children: [] }],
        },
      ],
    });

    expect(() => fromAstJson(withField("id") as never)).toThrow(/"id"/);
    // A BOGUS sibling on the same node is refused too, so the row above cannot
    // pass because validation was switched off wholesale.
    expect(() => fromAstJson(withField("bogus") as never)).toThrow(/"bogus"/);
    // CONTROL: the canonical spelling still decodes.
    expect(() => fromAstJson(withField("key") as never)).not.toThrow();
  });

  it("refuses an unnamed field on a definition term", () => {
    const entry = (extra: Record<string, unknown>) => ({
      type: "document",
      astVersion: "2.0",
      stages: ["blockImagePromotion", "referenceResolution", "tableAlignment"],
      srcByteLength: 0,
      children: [
        {
          type: "definition_list",
          spacing: "tight",
          children: [
            {
              type: "definition_term",
              children: [{ type: "text", value: "T" }],
              ...extra,
            },
            { type: "definition_description", children: [{ type: "paragraph", children: [] }] },
          ],
        },
      ],
    });

    expect(() => fromAstJson(entry({ bogus: "x" }) as never)).toThrow(/"bogus"/);
    // CONTROL: the typed term still decodes with its legal fields.
    expect(() => fromAstJson(entry({}) as never)).not.toThrow();
    expect(() => fromAstJson(entry({ attrs: { id: 'term' } }) as never)).not.toThrow();
  });

  it("does not let an unnamed field in on a type that never had one", () => {
    const payload = {
      type: "document",
      astVersion: "2.0",
      stages: ["blockImagePromotion", "referenceResolution", "tableAlignment"],
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
