import { describe, expect, it } from 'vitest'
import { carveToCarve, htmlToCarve, parse, renderCarve, renderHtml, type Document, type InlineNode } from '../src/index.js'

/*
 * Two backtick runs that touch merge into one, so two adjacent code spans - or
 * a code span and a raw inline - are separated by an empty delimited comment
 * (carve-js#1818). PART 11 section 10k N3 makes that comment compare equal to
 * nothing, which is why the separator does not change the document.
 */

const paragraph = (...children: InlineNode[]): Document =>
  ({ type: 'document', children: [{ type: 'paragraph', children }] }) as unknown as Document
const code = (value: string) => ({ type: 'code', value }) as InlineNode
const raw = (content: string) => ({ type: 'raw_inline', format: 'html', content }) as InlineNode
const text = (value: string) => ({ type: 'text', value }) as InlineNode

/** A tree compared under N3: every empty delimited comment drops out. */
const underN3 = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node
      .filter(
        (child) =>
          !(
            child !== null &&
            typeof child === 'object' &&
            (child as InlineNode).type === 'comment' &&
            (child as { delimited?: boolean }).delimited === true &&
            (child as { block?: boolean }).block === false &&
            (child as { content?: string }).content === ''
          ),
      )
      .map(underN3)
  }
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
      if (key === 'pos' || key === 'srcByteLength') continue
      out[key] = underN3((node as Record<string, unknown>)[key])
    }
    return out
  }

  return node
}

describe('two touching backtick runs', () => {
  it.each([
    ['two code spans', paragraph(code('a'), code('b')), '`a`{%  %}`b`\n'],
    ['a code span and a raw inline', paragraph(code('a'), raw('<b>')), '`a`{%  %}`<b>`{=html}\n'],
    ['three code spans', paragraph(code('a'), code('b'), code('c')), '`a`{%  %}`b`{%  %}`c`\n'],
    ['code spans between text', paragraph(text('t'), code('a'), code('b'), text('z')), 't`a`{%  %}`b`z\n'],
  ])('is written with a separator for %s', (_, document, carve) => {
    expect(renderCarve(document)).toBe(carve)
  })

  it.each([
    ['two code spans', paragraph(code('a'), code('b'))],
    ['a code span and a raw inline', paragraph(code('a'), raw('<b>'))],
  ])('re-parses to the tree it was written from, under N3, for %s', (_, document) => {
    expect(underN3(parse(renderCarve(document)))).toStrictEqual(underN3(document))
  })

  it('needs none where a raw inline comes first', () => {
    expect(renderCarve(paragraph(raw('<b>'), code('a')))).toBe('`<b>`{=html}`a`\n')
  })

  it('needs none where an attribute block ends the first span', () => {
    expect(renderCarve(paragraph({ type: 'code', value: 'a', attrs: { classes: ['x'] } } as InlineNode, code('b')))).toBe('`a`{.x}`b`\n')
  })

  it('needs none after an escaped backtick', () => {
    expect(renderCarve(paragraph(text('x`'), code('b')))).toBe('x\\``b`\n')
  })

  it('is a fixed point of the formatter', () => {
    const written = renderCarve(paragraph(code('a'), code('b')))
    expect(carveToCarve(written)).toBe(written)
  })

  it('imports adjacent code spans as two code spans', () => {
    const imported = htmlToCarve('<p><code>a</code><code>b</code></p>')
    expect(imported.value).toBe('`a`{%  %}`b`\n')
    expect(renderHtml(parse(imported.value))).toBe('<p><code>a</code><code>b</code></p>')
  })
})
