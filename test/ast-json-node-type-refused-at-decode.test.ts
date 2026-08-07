import { describe, expect, it } from 'vitest'
import {
  AstJsonNodeTypeError,
  AstJsonUnknownNodeTypeError,
  citations,
  fromAstJson,
  parse,
  toAstJson, AstJsonSchemaError } from '../src/index.js'

/**
 * A node whose `type` the schema does not name is refused AT DECODE, and a
 * missing or non-string `type` is that case (markup-carve/carve#881).
 *
 * PART 12 §12(c), `resources/grammar.ebnf:5810`:
 *
 *   (c) A NODE WHOSE `type` THE SCHEMA DOES NOT NAME, AT DECODE. Not in a
 *   renderer, one step later. The renderer's error names a RENDERING problem for
 *   what is really a payload problem, and it only ever arrives for a caller who
 *   renders: a formatter, a linter, a language server or an indexer may hold the
 *   tree and never reach a renderer at all.
 *
 * This engine implemented it only for a `type` that IS a string. Anything else
 * fell through to `renderHtml: unknown block undefined` / `unknown block
 * [object Object]`. carve-rs `2ec3c1c` and carve-php `876e312` both refuse at
 * decode.
 */
const doc = (child: unknown) => ({
  type: 'document',
  srcByteLength: 3,
  children: [child],
}) as never

describe('an ingested node', () => {
  it('is refused at decode when it carries no `type` at all', () => {
    expect(() => fromAstJson(doc({ children: [{ type: 'text', value: 'hi' }] }))).toThrow(
      AstJsonNodeTypeError,
    )
  })

  it('is refused at decode for every non-string `type`, not just a missing one', () => {
    // A number, `null`, an array, an object and a boolean each name no schema
    // type. The object case is the one that used to reach the renderer as
    // `unknown block [object Object]`.
    for (const value of [7, null, ['paragraph'], {}, true]) {
      expect(() => fromAstJson(doc({ type: value, children: [] }))).toThrow(AstJsonNodeTypeError)
    }
  })

  it('names the path it was found at, at every depth and on both node kinds', () => {
    // §9(b) asks for a failure "naming ... the PATH it appeared at, so a caller
    // can find it in a tree it did not write". A refusal that always said
    // `children[0]` would be no better than the renderer's.
    expect(() =>
      fromAstJson(doc({ type: 'paragraph', children: [{ value: 'hi' }] })),
    ).toThrow(/children\[0\]\.children\[0\]/)

    expect(() =>
      fromAstJson(
        doc({ type: 'block_quote', children: [{ children: [{ type: 'text', value: 'x' }] }] }),
      ),
    ).toThrow(/children\[0\]\.children\[0\]/)
  })

  it('is refused in a SINGLE-node position too, not only in an array', () => {
    // `figure.target` holds one node rather than a list. carve-rs reports
    // `figure.target.type is required` for exactly this payload.
    expect(() =>
      fromAstJson(
        doc({
          type: 'figure',
          caption: [{ type: 'text', value: 'c' }],
          target: { children: [{ type: 'text', value: 'x' }] },
        }),
      ),
    ).toThrow(/children\[0\]\.target/)
  })

  it('describes the value it found rather than stringifying it', () => {
    // The renderer reported `unknown block [object Object]`, which tells a
    // caller nothing about their payload. Reporting the raw value here would
    // reproduce that exactly, so the message carries the JSON form.
    expect(() => fromAstJson(doc({ type: {}, children: [] }))).toThrow(/a "type" of \{\}/)
    expect(() => fromAstJson(doc({ type: {}, children: [] }))).not.toThrow(/\[object Object\]/)
    expect(() => fromAstJson(doc({ children: [] }))).toThrow(/has no "type"/)
  })

  it('still refuses a string `type` the schema does not name', () => {
    // The CONTROL for the clause's already-implemented half: this was correct
    // before the change and must stay correct, and it must keep its own error
    // class so a caller can tell an unknown NAME from an unusable value.
    expect(() => fromAstJson(doc({ type: 'wat', children: [] }))).toThrow(
      AstJsonUnknownNodeTypeError,
    )
  })

  it('still accepts a valid tree', () => {
    // The CONTROL that bounds all of the above: no mutation of the type check
    // breaks it, and without it a decoder that refused everything would pass
    // every assertion here.
    expect(() =>
      fromAstJson(doc({ type: 'paragraph', children: [{ type: 'text', value: 'hi' }] })),
    ).not.toThrow()
  })
})

/**
 * The positions where a record with no `type` is what the schema PUTS there.
 * Requiring one would refuse a tree this engine's own parser produced, which
 * §9(a) forbids.
 */
describe('a record the schema gives no `type`', () => {
  it('is accepted where a citation group puts its items', () => {
    // `citation_group.items` holds `{key, suppressAuthor, ...}` records. This is
    // a tree the parser writes, round-tripped through the decoder: a blanket
    // "every object in a node position needs a `type`" refuses it outright.
    const tree = JSON.parse(
      JSON.stringify(
        toAstJson(parse('Text [@smith2020, p. 5; see @jones1999] here.\n', {
          extensions: [citations()],
        })),
      ),
    )

    expect(JSON.stringify(tree)).toContain('"citation_group"')
    expect(() => fromAstJson(tree)).not.toThrow()
  })

  it('is still checked INSIDE a citation item, where real nodes live', () => {
    // The exemption is for the item record itself, not for everything under it.
    // A citation's `prefix` and `locator` hold inline nodes, so a bad one there
    // is still a §12(c) refusal - otherwise the exemption would be a hole the
    // size of the subtree.
    expect(() =>
      fromAstJson(
        doc({
          type: 'paragraph',
          children: [
            {
              type: 'citation_group',
              raw: '[@a]',
              items: [{ key: 'a', suppressAuthor: false, prefix: [{ value: 'see' }] }],
            },
          ],
        }),
      ),
    ).toThrow(AstJsonNodeTypeError)
  })

  it('is still checked INSIDE a legacy definition entry, in both of its slots', () => {
    // Same rule as the citation item: the exemption is the record, not its
    // subtree. A legacy entry keeps its content under `terms` and `definitions`,
    // names the schema does not have, so `NODE_FIELDS` cannot reach them and the
    // walk stopped at the record - leaving every node in a stored definition
    // list unchecked, including against the string-type half of §12(c) that was
    // already implemented.
    const legacy = (terms: unknown, definitions: unknown) =>
      doc({ type: 'definition_list', items: [{ terms, definitions }] })
    const ok = [[{ type: 'paragraph', children: [] }]]

    expect(() => fromAstJson(legacy([[{ value: 'T' }]], ok))).toThrow(AstJsonNodeTypeError)
    expect(() => fromAstJson(legacy([[{ type: 'wat' }]], ok))).toThrow(
      AstJsonUnknownNodeTypeError,
    )
    expect(() => fromAstJson(legacy([[{ type: 'text', value: 'T' }]], [[{ children: [] }]]))).toThrow(
      AstJsonNodeTypeError,
    )
  })

  it('does not let an exempt position excuse a `type` that is PRESENT and unusable', () => {
    // Only PRESENCE is positional. The exemptions exist for records the schema
    // gives no `type` at all, so a CURRENT-form definition item carrying
    // `type: 7` must not ride in on the legacy grouping form's exemption - it
    // was accepted and then silently dropped by `entriesFromWire`. Same for a
    // citation item that grew one.
    expect(() =>
      fromAstJson(doc({ type: 'definition_list', items: [{ type: 7, children: [] }] })),
    ).toThrow(AstJsonNodeTypeError)

    expect(() =>
      fromAstJson(
        doc({
          type: 'paragraph',
          children: [
            { type: 'citation_group', raw: '[@a]', items: [{ type: null, key: 'a' }] },
          ],
        }),
      ),
    ).toThrow(AstJsonNodeTypeError)
  })

  it('does not excuse an untyped object that is not the legacy record', () => {
    // The exemption is granted for a SHAPE, so it is conditional on that shape.
    // `items: [{children: []}]` is neither a legacy entry nor a node;
    // `entriesFromWire` drops it, so exempting the whole POSITION would accept
    // the payload and make the content vanish.
    expect(() =>
      fromAstJson(doc({ type: 'definition_list', items: [{ children: [] }] })),
    ).toThrow(AstJsonNodeTypeError)

    // And the current typed form still decodes, which is what the schema
    // actually puts there.
    expect(() =>
      fromAstJson(
        doc({
          type: 'definition_list',
          items: [
            { type: 'definition_term', children: [] },
            { type: 'definition_description', children: [] },
          ],
        }),
      ),
    ).not.toThrow()
  })

  it('is accepted in the older definition-list grouping form', () => {
    // A legacy acceptance, recorded as one: `items: [{terms, definitions}]` is
    // what this engine published before the wire shape settled, those trees are
    // stored, and `definitionListsFromWire` still maps them.
    expect(() =>
      fromAstJson(
        doc({
          type: 'definition_list',
          items: [
            {
              terms: [[{ type: 'text', value: 'T' }]],
              definitions: [[{ type: 'paragraph', children: [] }]],
            },
          ],
        }),
      ),
    ).not.toThrow()
  })
})

/**
 * The rows markup-carve/carve#881 leaves UNRULED. They are not this clause's
 * business and this change must not decide them by accident.
 */
describe('the wrong-type rows, RULED by carve#881', () => {
  // These asserted the opposite and said so: "the unruled wrong-type rows",
  // parked pending a decision. §12(d) is that decision - an ingest validates
  // the WHOLE payload against the schema at decode, types and required fields
  // together. Both rows are invalid under the schema and were only ever
  // accepted because nothing consulted it.
  it('refuses a root `children` that is not an array', () => {
    // §12's own objection, arriving through a door the clause did not cover:
    // "a reader that supplies a default has turned a truncated document into an
    // empty one". That is exactly what reading `{}` as an empty document did.
    expect(() =>
      fromAstJson({ type: 'document', srcByteLength: 0, children: {} } as never),
    ).toThrow(AstJsonSchemaError)
  })

  it('refuses a `null` or a string child', () => {
    // Both used to reach the RENDERER and fail there with a bare TypeError -
    // untyped, which §9(b) forbids.
    expect(() => fromAstJson(doc(null))).toThrow(AstJsonSchemaError)
    expect(() => fromAstJson(doc('nope'))).toThrow(AstJsonSchemaError)
  })

  it('CONTROL: still accepts the valid document these are built from', () => {
    // Without this, sixteen rejections of a never-valid document would read
    // exactly like a clause being enforced.
    expect(() =>
      fromAstJson({
        type: 'document',
        srcByteLength: 1,
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }],
      } as never),
    ).not.toThrow()
  })
})
