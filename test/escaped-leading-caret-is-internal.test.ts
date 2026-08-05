import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

/**
 * `escapedLeadingCaret` is a parser-internal flag, not a wire field.
 *
 * It records that a text node's leading `^` came from `\^`, so the line is not
 * a caption marker and the image above it is not promoted to a figure. That is
 * a real fact and the parser needs it - but the WIRE already states it: an
 * `escaped_text` node carrying `"^"` sits immediately before the flagged text
 * node, which is exactly where a consumer would look.
 *
 * carve-rs and carve-php publish neither the flag nor anything in its place,
 * and a field one engine publishes and two do not is one a consumer cannot
 * rely on. carve#749 settled the identical shape - `refId`, a derivable field
 * published by this engine alone - by dropping it from the wire and keeping it
 * internally, which is what this does (carve#793).
 */
describe('escapedLeadingCaret does not reach the wire', () => {
  const src = '![a](p.png)\n\\^ cap\n'

  const textNodes = (tree: unknown): Array<Record<string, unknown>> => {
    const out: Array<Record<string, unknown>> = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return void node.forEach(walk)
      if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>
        if (record.type === 'text') out.push(record)
        Object.values(record).forEach(walk)
      }
    }
    walk(tree)
    return out
  }

  it('is absent from every published text node', () => {
    for (const node of textNodes(carveToAstJson(src))) {
      expect(node).not.toHaveProperty('escapedLeadingCaret')
    }
  })

  it('leaves the escaped_text node that states the same fact', () => {
    // The replacement is not "nothing" - it is the sibling a consumer reads.
    const json = JSON.stringify(carveToAstJson(src))
    expect(json).toContain('"escaped_text"')
  })

  it('still refuses to promote the image to a figure', () => {
    // The flag's PURPOSE, which is internal and must survive: an escaped caret
    // is not a caption marker, so this stays a paragraph.
    const html = carveToHtml(src)
    expect(html).not.toContain('<figure>')
    expect(html).toContain('^ cap')
  })

  it('still promotes when the caret is a real marker', () => {
    // The control: without the escape the same two lines ARE a figure, so the
    // test above is not passing because promotion is broken generally.
    expect(carveToHtml('![a](p.png)\n^ cap\n')).toContain('<figure>')
  })
})
