import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve, renderHtml, resolve } from '../src/index.js'
import type { Document, Paragraph } from '../src/index.js'

const continued = (prefix: string): string => prefix.replace(/^- $/, '  ')

// CARVE-P11-077: under rule A an indented `---` opens a thematic break and `\---` reads as `-–`.
function dashLine(hyphens: number, prefix: string): Document {
  const doc = parse(`${prefix}foo\n${continued(prefix)}bar\n`) as Document
  let para: Paragraph | undefined
  const visit = (nodes: Document['children']): void => {
    for (const node of nodes) {
      if (node.type === 'paragraph') para ??= node
      else if ('items' in node) visit(node.items as unknown as Document['children'])
      else if ('children' in node && Array.isArray(node.children)) visit(node.children as Document['children'])
    }
  }
  visit(doc.children)
  const dashes = (parse(`x ${'-'.repeat(hyphens)} y`).children[0] as Paragraph).children
    .filter(inline => inline.type === 'smart_punctuation')
  const [foo, , bar] = para!.children
  para!.children = [foo!, { type: 'soft_break' }, ...dashes, { type: 'soft_break' }, bar!]
  return doc
}

describe('a dash-only paragraph line', () => {
  const expected: Record<number, string> = { 3: '—', 4: '––', 5: '—–', 6: '——', 7: '—––' }
  for (const prefix of ['', '- ', '> ']) {
    for (const [hyphens, glyphs] of Object.entries(expected)) {
      it(`writes ${hyphens} hyphens as ${glyphs} under ${JSON.stringify(prefix)}`, () => {
        const doc = dashLine(Number(hyphens), prefix)
        const written = renderCarve(doc)
        expect(written).toContain(`\n${continued(prefix)}${glyphs}\n`)
        expect(written).not.toContain('\\-')
        expect(carveToHtml(written)).toBe(renderHtml(resolve(doc)))
        expect(renderCarve(parse(written))).toBe(written)
      })
    }
  }

  it('keeps a dash beside other text as written', () => {
    expect(renderCarve(parse('a --- b\n'))).toBe('a --- b\n')
    expect(renderCarve(parse('a---b\n'))).toBe('a---b\n')
  })
})
