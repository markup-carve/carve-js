import { describe, expect, it } from 'vitest'

import { fromAstJson, parse, renderCarve, SourceUnspellableError, toAstJson } from '../src/index.js'
import type { Document, InlineNode } from '../src/ast.js'

/*
 * A CARRIAGE RETURN IS NORMALIZED AT INGEST, NOT REFUSED AND NOT WRITTEN OUT
 * (carve-js#1352; the ruling on that ticket).
 *
 * PART 0 splits input on `'\n'`, `'\r\n'` or a lone `'\r'`, and `newline =
 * '\n' | '\r\n' | '\r'` - all three engines have agreed since
 * markup-carve/carve#872. So no SOURCE text can produce a value holding a
 * literal CR: it arrives only by constructing a tree or by ingesting one, and
 * through the AST door it arrives routinely, because a payload built from a
 * CRLF document carries the pair in every multi-line value it has.
 *
 * WHY NORMALIZE RATHER THAN REFUSE, which was the live alternative. This is a
 * CHARACTER that cannot appear, like PART 12 §21's NUL, not a whitespace SHAPE
 * like the three markup-carve/carve-js#1344 refuses. Collapsing is lossless -
 * a carriage return already means exactly "line terminator" everywhere else in
 * the language - and refusing would turn away CRLF-sourced input that is
 * completely ordinary in provenance.
 *
 * WHY AT INGEST RATHER THAN IN THE WRITER: so a constructed tree and an
 * ingested one behave the same, instead of the writer holding a rule only one
 * of its two callers can trip.
 */

const CR = '\r'
const CRLF = '\r\n'

/** Every string anywhere in a tree, values and keys' contents alike. */
function everyString(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) everyString(child, out)
    return out
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) everyString(value, out)
    return out
  }
  return out
}

/**
 * An AST payload a reader of a CRLF file would hand over.
 *
 * Hand-built rather than round-tripped through `parse`, because `parse` is the
 * OTHER door and normalizes on its own - a payload that came from it could
 * never carry the character this is about.
 */
const crlfPayload = () => ({
  type: 'document',
  srcByteLength: 0,
  children: [
    { type: 'code_block', content: `a${CRLF}b${CR}c` },
    {
      type: 'paragraph',
      children: [
        { type: 'text', value: `x${CRLF}y` },
        { type: 'code', value: `p${CRLF}q` },
      ],
    },
    { type: 'raw_block', format: 'html', content: `<i>${CRLF}</i>` },
  ],
})

describe('a carriage return collapses at the ingest boundary', () => {
  it('leaves no carriage return in any value of an ingested CRLF document', () => {
    const doc = fromAstJson(crlfPayload() as never)
    const carrying = everyString(doc).filter((value) => value.includes(CR))

    expect(carrying).toEqual([])
  })

  it('collapses the pair and the lone return to the same line feed', () => {
    const doc = fromAstJson(crlfPayload() as never) as Document
    const block = doc.children[0] as { content: string }

    expect(block.content).toBe('a\nb\nc')
  })

  it('CONTROL: the payload really did carry them, so the walk above can fail', () => {
    const carrying = everyString(crlfPayload()).filter((value) => value.includes(CR))

    expect(carrying).toEqual([`a${CRLF}b${CR}c`, `x${CRLF}y`, `p${CRLF}q`, `<i>${CRLF}</i>`])
  })

  it('hands the writer exactly what the line-feed spelling would have handed it', () => {
    // The writer is never handed a carriage return: an ingested CRLF document
    // and the same document spelled with line feeds are the SAME tree by the
    // time either reaches `renderCarve`, so they write the same bytes.
    const lf = JSON.parse(JSON.stringify(crlfPayload()).replace(/\\r\\n|\\r/g, '\\n'))

    expect(renderCarve(fromAstJson(crlfPayload() as never))).toBe(
      renderCarve(fromAstJson(lf as never)),
    )
    expect(renderCarve(fromAstJson(crlfPayload() as never))).not.toContain(CR)
  })

  it('does not disturb the NUL replacement sharing the same walk', () => {
    const doc = fromAstJson({
      type: 'document',
      srcByteLength: 0,
      children: [{ type: 'code_block', content: `a\0b${CRLF}c` }],
    } as never) as Document

    expect((doc.children[0] as { content: string }).content).toBe('a\ufffdb\nc')
  })

  it('does not mutate the payload the caller passed in', () => {
    // The walk is structurally shared: a branch it has to change is COPIED, so
    // the caller's own object keeps what it had. That property is the reason
    // both characters can be answered in one pass without the pass being felt.
    const payload = crlfPayload()
    fromAstJson(payload as never)

    expect((payload.children[0] as { content: string }).content).toBe(`a${CRLF}b${CR}c`)
  })

  it('leaves a payload carrying neither character alone', () => {
    const payload = toAstJson(parse('```\na\nb\n```\n'))

    expect(fromAstJson(payload).children[0]).toEqual(
      fromAstJson(toAstJson(parse('```\na\nb\n```\n'))).children[0],
    )
  })

  describe('the markup-carve/carve-js#1344 refusals are untouched', () => {
    const inParagraph = (node: InlineNode): Document => ({
      type: 'document',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x ' }, node] }],
    })

    const refusalReason = (doc: Document): string | undefined => {
      try {
        renderCarve(doc)
      } catch (error) {
        return (error as SourceUnspellableError).reason
      }
      return undefined
    }

    it('still refuses a line edge carrying whitespace, spelled with a return', () => {
      // A CONSTRUCTED tree, not an ingested one: the ingest boundary would have
      // collapsed the terminator first, and the shape would then be refused for
      // its line-feed spelling instead. Either way it is refused - which is the
      // point, since the rule is about the SHAPE.
      expect(refusalReason(inParagraph({ type: 'code', value: `a ${CR}b` }))).toBe(
        'a line of the value ends in whitespace, which the block layer strips',
      )
      expect(refusalReason(inParagraph({ type: 'code', value: `a${CR} b` }))).toBe(
        'a line of the value starts with whitespace, which the block layer strips',
      )
    })

    it('does not refuse a bare return, which is a character and not a shape', () => {
      // The widening this ticket declined. `a\rb` has no whitespace at either
      // line edge, so no #1344 condition describes it, and normalizing is what
      // it gets.
      expect(refusalReason(inParagraph({ type: 'code', value: `a${CR}b` }))).toBeUndefined()

      const ingested = fromAstJson({
        type: 'document',
        srcByteLength: 0,
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'x ' },
              { type: 'code', value: `a${CR}b` },
            ],
          },
        ],
      } as never)

      expect(renderCarve(ingested)).toBe('x `a\nb`\n')
    })
  })
})
