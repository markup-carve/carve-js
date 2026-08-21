import { describe, it, expect } from 'vitest'
import { parse, carveToAstJson, carveToHtml } from '../src/index.js'
import type { InlineNode, Text } from '../src/ast.js'

/**
 * An escaped caret is literal, and the AST says so with a NODE, not a flag.
 *
 * The parser used to hang a boolean, `escapedLeadingCaret`, on the text node
 * that followed a `\^`. It was never a wire field - carve-js#735 stripped it at
 * the boundary, and neither carve-rs nor carve-php ever published anything in
 * its place - and by the time carve-js#1259 looked, it had no live reader
 * either: the one guard that consulted it, in `promoteBlockImages`, sits behind
 * a `type === 'text'` test that an `escaped_text` node can never pass. Its only
 * remaining observable effect was to be WRONG, firing after any two adjacent
 * escaped carets, where no caret leads at all.
 *
 * So it is gone. What states the fact instead is the `escaped_text` node holding
 * `"^"` - the authored form the parser keeps on purpose, which
 * `coalesceTextRuns` never merges into a text node.
 *
 * These tests pin both halves: the flag is absent from every shape that used to
 * carry it, and the BEHAVIOR it was supposed to protect is unchanged.
 */
describe('an escaped caret is literal, and no flag records it', () => {
  const texts = (tree: unknown): Array<Record<string, unknown>> => {
    const out: Array<Record<string, unknown>> = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return void node.forEach(walk)
      if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>
        if (record['type'] === 'text') out.push(record)
        Object.values(record).forEach(walk)
      }
    }
    walk(tree)
    return out
  }

  // The four shapes from carve-js#1259. The first two are what the old
  // predicate got wrong - `buf === ''` was meant to mean "this caret leads",
  // but the buffer is ALSO empty right after the previous escape flushed it, so
  // a second `\^` inherited the flag and dropped it on whatever came next. The
  // last two are the negatives that stop any replacement from over-firing.
  const shapes: Array<[string, string]> = [
    ['{\\^\\^}', 'two adjacent escapes between braces: the old flag landed on `}`'],
    ['}\\^\\^{', 'two adjacent escapes, braces reversed: it landed on `{`'],
    ['}\\^p', 'a single escape after a brace: it correctly did not fire'],
    ['x\\^p', 'a single escape mid-word: it correctly did not fire'],
  ]

  for (const [src, why] of shapes) {
    it(`carries no flag on any text node - ${why}`, () => {
      const nodes = texts(parse(src + '\n'))
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        expect(node).not.toHaveProperty('escapedLeadingCaret')
        // Not just this one name: a text node carries a value and a span, and
        // nothing else - so a replacement flag under ANY name fails here too.
        expect(Object.keys(node).sort()).toEqual(['pos', 'type', 'value'])
      }
    })

    it(`publishes no flag on the wire - ${why}`, () => {
      expect(JSON.stringify(carveToAstJson(src + '\n'))).not.toContain('escapedLeadingCaret')
    })
  }

  it('states the escape with an escaped_text node instead', () => {
    // The replacement is not "nothing" - it is the sibling a consumer reads.
    const children = (parse('\\^ cap\n').children[0] as { children: InlineNode[] }).children
    expect(children[0]!.type).toBe('escaped_text')
    expect((children[0] as { value: string }).value).toBe('^')
    expect((children[1] as Text).value).toBe(' cap')
  })
})

describe('the behavior the flag was supposed to protect', () => {
  it('refuses to promote an image whose caption marker is escaped', () => {
    const html = carveToHtml('![a](p.png)\n\\^ cap\n')
    expect(html).not.toContain('<figure>')
    expect(html).toContain('^ cap')
  })

  it('still promotes when the caret is a real marker', () => {
    // The control: without the escape the same two lines ARE a figure, so the
    // test above is not passing because promotion is broken generally.
    expect(carveToHtml('![a](p.png)\n^ cap\n')).toContain('<figure>')
  })

  it('refuses when the escaped caption line also carries an inline comment', () => {
    // The `%%` branch flushes the buffer directly rather than through flush(),
    // so it used to need its own copy of the flag. It does not need one: the
    // escaped_text node is what refuses the promotion.
    const html = carveToHtml('![a](p.png)\n\\^ cap %% note\n')
    expect(html).not.toContain('<figure>')
    expect(html).toContain('^ cap')
  })

  it('refuses when the escaped caption text is an abbreviation', () => {
    // The abbreviation split used to propagate the flag onto the leading
    // fragment for exactly this shape.
    const html = carveToHtml('*[ABC]: Alphabet\n\n![a](p.png)\n\\^ ABC\n')
    expect(html).not.toContain('<figure>')
  })

  it('promotes the same shapes when the caret is not escaped', () => {
    // Controls for the two above.
    expect(carveToHtml('![a](p.png)\n^ cap %% note\n')).toContain('<figure>')
    expect(carveToHtml('*[ABC]: Alphabet\n\n![a](p.png)\n^ ABC\n')).toContain('<figure>')
  })
})
