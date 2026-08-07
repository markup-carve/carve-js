import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AstJsonNodeTypeError,
  AstJsonRootError,
  AstJsonSchemaError,
  AstJsonUnknownFieldError,
  carveToAstJson,
  carveToHtml,
  fromAstJson,
} from '../src/index.js'

/**
 * PART 12 §12(d): AN INGEST VALIDATES THE WHOLE PAYLOAD AGAINST
 * `resources/ast-schema.json` (markup-carve/carve#881).
 *
 * Types and required fields together, at DECODE, refused with the same typed
 * error §12(a), (b) and (c) already require.
 *
 * NOT a fourth list of leniency points. The schema is the list, it already
 * described every row below, and those rows were only ever divergent because
 * nothing consulted it. Ruling them one at a time is what produced the state
 * this replaces.
 *
 * The sixteen shapes carve#881 measured, plus the VALID document they are all
 * built from - without which sixteen rejections of a never-valid document would
 * read exactly like a clause being enforced.
 *
 * This engine's column before the change: it ACCEPTED five outright, and five
 * more reached the RENDERER and failed there with a bare `TypeError` or `Error`,
 * which §9(b) forbids. Only the three `attrs`/`pos` unknown-property rows and
 * the two `type` rows were already refused, by §11 and §12(c).
 */

type Doc = Record<string, unknown>

/** The valid document every shape below is a single mutation away from. */
const valid = (): Doc => ({
  type: 'document',
  children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }],
  srcByteLength: 1,
})

const para = (d: Doc): Doc => (d.children as Doc[])[0]!
const text = (d: Doc): Doc => (para(d).children as Doc[])[0]!

const REFUSED: Array<[string, (d: Doc) => void, unknown]> = [
  ['root srcByteLength is the wrong TYPE', (d) => void (d.srcByteLength = '1'), AstJsonSchemaError],
  ['root srcByteLength is negative', (d) => void (d.srcByteLength = -1), AstJsonSchemaError],
  ['root children is the wrong type', (d) => void (d.children = 'x'), AstJsonSchemaError],
  ['root children is null', (d) => void (d.children = null), AstJsonSchemaError],
  ['a paragraph is missing children', (d) => void delete para(d).children, AstJsonSchemaError],
  ['a text node is missing value', (d) => void delete text(d).value, AstJsonSchemaError],
  ['a text value is a number', (d) => void (text(d).value = 7), AstJsonSchemaError],
  ['a child is null', (d) => void (para(d).children = [null]), AstJsonSchemaError],
  ['a child is a string', (d) => void (para(d).children = ['x']), AstJsonSchemaError],
  ['attrs is {"class": "x"}', (d) => void (para(d).attrs = { class: 'x' }), AstJsonUnknownFieldError],
  [
    'attrs carries a bogus key beside keyValues',
    (d) => void (para(d).attrs = { keyValues: {}, nope: 1 }),
    AstJsonUnknownFieldError,
  ],
  ['attrs is the wrong type', (d) => void (para(d).attrs = 'x'), AstJsonSchemaError],
  [
    'pos carries an extra key',
    (d) =>
      void (para(d).pos = {
        startOffset: 0,
        endOffset: 1,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 2,
        nope: 1,
      }),
    AstJsonUnknownFieldError,
  ],
  [
    'pos is missing endOffset',
    (d) =>
      void (para(d).pos = { startOffset: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 }),
    AstJsonSchemaError,
  ],
  ['the root has no type', (d) => void delete d.type, AstJsonRootError],
  ['a node type is not a string', (d) => void (para(d).type = 7), AstJsonNodeTypeError],
]

describe('an ingest validates the whole payload against the schema', () => {
  it('accepts the valid document the sixteen shapes are built from', () => {
    // FIRST, and load-bearing. Sixteen rejections of a document that was never
    // valid would look exactly like this clause being enforced.
    const doc = fromAstJson(valid() as never)

    expect(doc.children).toHaveLength(1)
  })

  for (const [name, mutate, error] of REFUSED) {
    it(`refuses a payload where ${name}`, () => {
      const doc = valid()
      mutate(doc)

      expect(() => fromAstJson(doc as never)).toThrow(error as never)
    })
  }

  it('refuses every one of them with a TYPED error, which is half the clause', () => {
    // §9(b) forbids an untyped refusal, and five of these used to reach the
    // RENDERER and fail there with a bare TypeError - a stack trace from inside
    // a renderer for a document the decoder had already accepted.
    for (const [, mutate] of REFUSED) {
      const doc = valid()
      mutate(doc)
      let thrown: unknown
      try {
        fromAstJson(doc as never)
      } catch (e) {
        thrown = e
      }

      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).name).toMatch(/^AstJson/)
    }
  })
})

describe('a node position is checked for WHICH node, not only that it is one', () => {
  // Both raised by codex review on the change that added the validator, and
  // both real: checking the container alone leaves the schema half-consulted,
  // and each of these decoded cleanly and then threw an UNTYPED error from
  // inside the renderer - the exact failure §12(d) exists to stop.
  it('refuses a BLOCK node where the schema names an inline one', () => {
    // Threw `renderHtml: unknown inline paragraph`.
    expect(() =>
      fromAstJson({
        type: 'document',
        srcByteLength: 1,
        children: [{ type: 'paragraph', children: [{ type: 'paragraph', children: [] }] }],
      } as never),
    ).toThrow(AstJsonSchemaError)
  })

  it('refuses an INLINE node where the schema names a block one', () => {
    expect(() =>
      fromAstJson({
        type: 'document',
        srcByteLength: 1,
        children: [{ type: 'text', value: 'x' }],
      } as never),
    ).toThrow(AstJsonSchemaError)
  })

  it('refuses a scalar in a oneOf node slot', () => {
    // `figure.target` is spelled `oneOf` of five concrete node refs, a shape the
    // first version of the generator skipped entirely. Threw
    // `TypeError: Cannot read properties of undefined`.
    //
    // Measured with `caption` PRESENT: without it the payload is refused for a
    // missing required field instead, which looks like this rule working and is
    // not - the first probe of this finding made exactly that mistake.
    expect(() =>
      fromAstJson({
        type: 'document',
        srcByteLength: 1,
        children: [{ type: 'figure', target: 'x', caption: [] }],
      } as never),
    ).toThrow(AstJsonSchemaError)
  })

  it('CONTROL: accepts each node type the position DOES admit', () => {
    // Otherwise the rule could be "refuse every node position".
    for (const target of [
      { type: 'image', src: '/a.png', alt: '' },
      { type: 'paragraph', children: [] },
      { type: 'block_quote', children: [] },
    ]) {
      expect(() =>
        fromAstJson({
          type: 'document',
          srcByteLength: 1,
          children: [{ type: 'figure', target, caption: [] }],
        } as never),
      ).not.toThrow()
    }
  })
})

describe('what §12(d) deliberately does not annex', () => {
  it('accepts a srcByteLength that is present and WRONG', () => {
    // (a) is about the field's PRESENCE and (d) about its type and sign, not
    // about the number being right. It is derivable and nothing in the tree
    // depends on it, so tightening must not quietly reach it.
    const doc = valid()
    doc.srcByteLength = 99999

    expect(() => fromAstJson(doc as never)).not.toThrow()
  })

  it('accepts an attribute literally named "type", which is not a node', () => {
    // `{type=widget}` puts an object shaped {"type":"widget"} in the tree, and a
    // walk that treated it as a node would refuse a document this engine's own
    // parser produced - which §9(a) forbids.
    expect(carveToHtml('{type=widget}\ntext\n')).toContain('type="widget"')
    // Starting from a tree the PARSER produced, not a hand-built one.
    const round = fromAstJson(
      JSON.parse(JSON.stringify(carveToAstJson('{type=widget}\ntext\n'))) as never,
    )

    expect(round.children).toHaveLength(1)
  })
})

describe('section 9(a): it never refuses a tree this engine produced', () => {
  // THE GUARD THIS WHOLE CHANGE TURNS ON. A validator is precisely the change
  // that can start refusing the engine's own output, and section 9(a) forbids
  // it - so every corpus document goes out through the encoder and back through
  // the decoder, with positions off and on, because `pos` is where most of the
  // schema's required fields live.
  const corpusDir = resolve(fileURLToPath(new URL('../spec/tests/corpus', import.meta.url)))
  const names = readdirSync(corpusDir).filter((f) => f.endsWith('.crv')).sort()

  it('round-trips every corpus document, with and without positions', () => {
    const refused: string[] = []
    let accepted = 0
    for (const name of names) {
      const source = readFileSync(resolve(corpusDir, name), 'utf8')
      for (const positions of [false, true]) {
        const payload = JSON.parse(JSON.stringify(carveToAstJson(source, { positions })))
        try {
          fromAstJson(payload)
          accepted++
        } catch (e) {
          refused.push(`${name} (positions=${positions}): ${(e as Error).message}`)
        }
      }
    }

    // Presence FIRST: zero refusals out of zero round trips reads exactly like
    // a clean run and is not one.
    expect(accepted).toBeGreaterThan(1000)
    expect(refused).toEqual([])
  })
})
