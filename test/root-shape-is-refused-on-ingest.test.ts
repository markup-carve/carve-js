/*
 * PART 12 §12: an ingest refuses a root shape that deviates from §7.
 *
 * Three rows, all measured against this engine before the clause landed:
 * a root missing `children` or `srcByteLength` was accepted and repaired
 * (`children` fell through to `[]`, `srcByteLength` was simply left off), and a
 * node whose type the schema does not name was accepted at decode and thrown on
 * one step later by the renderer.
 *
 * Every payload here is a MUTATION of this engine's own output, so a refusal is
 * about the mutation rather than about whatever else a hand-written tree was
 * missing.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AstJsonRootFieldError,
  AstJsonUnknownNodeTypeError,
  carveToHtml,
  fromAstJson,
  parse,
  renderHtml,
  toAstJson,
} from "../src/index.js";
import { NODE_FIELDS, WIRE_FIELDS } from "../src/wire-fields.js";

const wire = (source: string) =>
  JSON.parse(JSON.stringify(toAstJson(parse(source)))) as Record<string, unknown>;

describe("an ingest refuses a root that deviates from PART 12 §7", () => {
  it("accepts its own output, which is the control on everything below", () => {
    // §9(a): serialize-then-ingest is an identity on anything this parser can
    // produce. Without this row every assertion here is satisfied by a decoder
    // that refuses everything.
    expect(renderHtml(fromAstJson(wire("hi") as never))).toBe("<p>hi</p>");
  });

  for (const field of ["children", "srcByteLength"] as const) {
    it(`refuses a root with no \`${field}\`, naming it`, () => {
      const payload = wire("hi");
      delete payload[field];
      let thrown: unknown;
      try {
        fromAstJson(payload as never);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AstJsonRootFieldError);
      // The VALUE, not the shape: before this, a missing `children` produced a
      // valid empty document and a missing `srcByteLength` produced a valid
      // document with the field absent. Both "returned a Document", so any
      // assertion about the returned shape passed against the defect.
      expect((thrown as AstJsonRootFieldError).field).toBe(field);
      expect((thrown as Error).message).toContain(field);
    });
  }

  it("refuses a root with no `type` as a foreign root, not as a missing field", () => {
    // §9's own closing paragraph already covered the root TYPE, so this row was
    // conformant before §12 and must stay reported as what it is.
    const payload = wire("hi");
    delete payload.type;
    expect(() => fromAstJson(payload as never)).toThrow(/is not "document"/);
  });

  it("does not check the VALUE of `srcByteLength`", () => {
    // §12(a) is about PRESENCE. The value is derivable and nothing depends on
    // it, so all three engines ignore it - deliberately, not by oversight.
    const payload = wire("hi");
    payload.srcByteLength = 99999;
    expect(renderHtml(fromAstJson(payload as never))).toBe("<p>hi</p>");
  });
});

describe("an ingest refuses an unknown node type at decode", () => {
  it("refuses a block child the schema does not name, before any renderer", () => {
    const payload = wire("hi");
    (payload.children as unknown[]).push({ type: "zzNotInTheSchema", children: [] });
    let thrown: unknown;
    try {
      fromAstJson(payload as never);
    } catch (error) {
      thrown = error;
    }
    // The class is the assertion that matters. This engine already threw for
    // this payload - from `renderHtml`, one step later - so "it throws" passed
    // against the defect for as long as the defect existed.
    expect(thrown).toBeInstanceOf(AstJsonUnknownNodeTypeError);
    expect((thrown as AstJsonUnknownNodeTypeError).nodeType).toBe("zzNotInTheSchema");
    expect((thrown as AstJsonUnknownNodeTypeError).path).toBe("children[1]");
  });

  it("refuses an inline the schema does not name, and says where", () => {
    // A separate row: a decoder can turn a foreign BLOCK away at the top of its
    // child loop and still walk a foreign inline into the tree.
    const payload = wire("hi");
    const first = (payload.children as Array<Record<string, unknown>>)[0];
    (first.children as unknown[]).push({ type: "zzNotInTheSchema" });
    let thrown: unknown;
    try {
      fromAstJson(payload as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AstJsonUnknownNodeTypeError);
    expect((thrown as AstJsonUnknownNodeTypeError).path).toBe("children[0].children[1]");
  });

  it("refuses one nested inside a container, not only at the top level", () => {
    const payload = wire("> quoted\n");
    const quote = (payload.children as Array<Record<string, unknown>>)[0];
    (quote.children as unknown[]).push({ type: "zzNotInTheSchema", children: [] });
    expect(() => fromAstJson(payload as never)).toThrow(AstJsonUnknownNodeTypeError);
  });
});

describe("the unknown-type check never reaches attrs.keyValues", () => {
  it("ingests `{type=widget}`, which this engine's own parser produces", () => {
    // THE TRAP. Attribute names are ordinary identifiers and `type` is one, so
    // this document serializes an object literally shaped {"type":"widget"} in
    // the tree. A walker that refused any object whose `type` it did not know
    // would refuse a document this build just parsed, which §9(a) forbids - and
    // it would do so for a document nothing else in this suite covers.
    const source = "[x](/u){type=widget}";
    const payload = wire(source);
    expect(JSON.stringify(payload)).toContain('"keyValues":{"type":"widget"}');
    expect(renderHtml(fromAstJson(payload as never))).toBe(carveToHtml(source));
  });

  it("does not list `keyValues` as a node-bearing field", () => {
    // The structural half of the same guarantee: the walk is driven by this
    // list, so `keyValues` being absent from it is what makes the row above
    // hold for every document rather than for the one tested.
    expect(NODE_FIELDS).not.toContain("keyValues");
    expect(NODE_FIELDS).toContain("children");
  });

  it("names every node-bearing field the schema has, not a hardcoded few", () => {
    // A list that missed a field would leave an unknown type under it accepted.
    // `content` and `title` are the ones a hand-written list gets wrong: both
    // hold nodes on one type and a plain string on another.
    for (const field of ["caption", "cells", "content", "inline", "items", "rows", "target", "title"]) {
      expect(NODE_FIELDS, field).toContain(field);
    }
    // Derived from the same schema as the field map beside it.
    expect(WIRE_FIELDS.document).toEqual(["children", "srcByteLength", "type"]);
  });
});

describe("the encoder always publishes the field the decoder now requires", () => {
  it("emits `srcByteLength` for a Document that never came from parse", () => {
    // §9(a): ingest must accept anything this engine can produce. `parse` is not
    // the only producer - an editor, a language server or an extension hands a
    // Document over too, and `srcByteLength` is optional on the runtime type. The
    // encoder used to omit it for exactly those, publishing a tree the schema
    // marks invalid, and §12 then refused this engine's own output.
    const handBuilt = {
      type: "document",
      children: [{ type: "paragraph", children: [{ type: "text", value: "x" }] }],
    };
    const encoded = toAstJson(handBuilt as never);
    // The VALUE, not just presence: a check for the key alone passes against an
    // encoder that writes `undefined`, which JSON.stringify then drops again.
    expect(encoded.srcByteLength).toBe(0);
    expect(JSON.stringify(encoded)).toContain('"srcByteLength":0');
    expect(() => fromAstJson(encoded)).not.toThrow();
  });

  it("keeps the real length when there is one", () => {
    // The control: the fallback must not overwrite a length the parser measured.
    expect(toAstJson(parse("hello")).srcByteLength).toBe(5);
  });
});

describe("the wire type says what the decoder enforces", () => {
  it("declares all three §7 root fields as required", () => {
    // A TypeScript consumer could build an `AstJsonDocument` with no
    // `srcByteLength`, satisfy the compiler, and only learn at runtime that
    // `fromAstJson` refuses it. A type check cannot run at runtime, so this
    // asserts on the emitted declaration instead of on a value.
    const dts = readFileSync(new URL("../dist/ast-json.d.ts", import.meta.url), "utf8");
    const root = dts.slice(
      dts.indexOf("interface AstJsonDocument"),
      dts.indexOf("}", dts.indexOf("interface AstJsonDocument")),
    );
    expect(root).toContain("srcByteLength: number");
    expect(root).not.toContain("srcByteLength?");
    expect(root).not.toContain("children?");
  });
});
