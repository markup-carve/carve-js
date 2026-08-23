import { describe, expect, it } from 'vitest'
import { carveToAstJson, fromAstJson, parse, renderCarve, renderHtml, toAstJson } from '../src/index.js'

/*
 * `start: 1` does not cross the wire OUT, whichever way the tree arrived.
 *
 * `resources/ast-schema.json` describes the field as "First number of an
 * ordered list, when it is not 1." That is a statement about what a conformant
 * tree looks like, and an encoder is the thing that has to honor it.
 *
 * This engine never WROTE one - `parse("1. a")` emits no `start`. It ECHOED one
 * (markup-carve/carve#1615, carve-js#1391): the codec copies an ingested record
 * wholesale, so a hand-built payload spelling out the default came straight back
 * out, and the encoder's output depended on where the tree came from. carve-php
 * already normalized; carve-js and carve-rs did not.
 *
 * PART 12 §6's round trip is scoped to `parse(x)` - a parsed tree, which never
 * carries `start: 1` - so it gives no cover to preserving the field on a
 * hand-built payload. Normalizing is lossless: `start: 1` and no `start`
 * describe the same document.
 *
 * THE RULE, for the ports: an encoder writes `start` only when the value is not
 * 1. Every OTHER value is meaningful and is written - `0` and `2` below are the
 * controls that separate this from dropping `start` outright.
 */

/** A one-item ordered list whose `start` spells out the default. */
function payload(start: number): Record<string, unknown> {
  return {
    type: 'document',
    srcByteLength: 0,
    children: [
      {
        type: 'list',
        ordered: true,
        tight: true,
        delim: '.',
        start,
        items: [
          {
            type: 'list_item',
            children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }] }],
          },
        ],
      },
    ],
  }
}

/** The `start` the encoder republishes for an ingested tree carrying `start`. */
function republishedStart(start: number): unknown {
  const wire = toAstJson(fromAstJson(payload(start) as never)) as unknown as {
    children: Array<Record<string, unknown>>
  }
  return wire.children[0]!['start']
}

describe('an ingested ordered-list start of 1', () => {
  it('is not republished', () => {
    // The defect. The field is absent, not present-and-1.
    expect(republishedStart(1)).toBeUndefined()
  })

  it('leaves the rest of the list node alone', () => {
    // The control for "drop the whole node" and for "drop every field": what
    // the payload said about ordering, tightness and delimiter still crosses.
    const wire = toAstJson(fromAstJson(payload(1) as never)) as unknown as {
      children: Array<Record<string, unknown>>
    }

    expect(wire.children[0]).toMatchObject({ type: 'list', ordered: true, tight: true, delim: '.' })
    expect(JSON.stringify(wire)).toContain('"value":"a"')
  })

  it('keeps a start of 2, which is not the default', () => {
    // The control that separates the fix from "drop `start` always".
    expect(republishedStart(2)).toBe(2)
  })

  it('keeps a start of 0, which is not the default either', () => {
    // 0 is falsy, so a fix written as a truthiness test would eat it.
    expect(republishedStart(0)).toBe(0)
  })

  it('normalizes a nested list too, not only a top-level one', () => {
    // The encoder walks the whole tree; a fix applied only to `doc.children`
    // would leave an inner list publishing the default.
    const tree = payload(2)
    const item = (tree['children'] as Array<Record<string, unknown>>)[0]!
    const inner = (item['items'] as Array<Record<string, unknown>>)[0]!
    ;(inner['children'] as unknown[]).push({
      type: 'list',
      ordered: true,
      tight: true,
      delim: '.',
      start: 1,
      items: [
        {
          type: 'list_item',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'b' }] }],
        },
      ],
    })

    const republished = JSON.stringify(toAstJson(fromAstJson(tree as never)))

    expect(republished).toContain('"start":2')
    expect(republished).not.toContain('"start":1')
  })

  it('is not produced by a fresh parse either', () => {
    // The baseline the ruling rests on: the parse side already complies, so
    // this only ever showed up on an ingested tree.
    expect(JSON.stringify(carveToAstJson('1. a\n'))).not.toContain('"start"')
  })

  it('does not change what the document renders to', () => {
    // Normalizing is lossless. Both exits still describe a list starting at 1,
    // and `<ol>` with no `start` attribute is already what this engine emits.
    const doc = fromAstJson(payload(1) as never)

    expect(renderHtml(doc)).toBe(renderHtml(parse('1. a\n')))
    expect(renderCarve(doc).trimEnd()).toBe('1. a')
  })

  it('still writes the start attribute for a list that does not begin at 1', () => {
    // The other half of the control: dropping 1 must not have made the renderer
    // stop caring about the field.
    expect(renderHtml(fromAstJson(payload(2) as never))).toContain('start="2"')
  })
})
