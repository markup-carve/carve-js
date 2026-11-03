import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

const source = '- a\n%% c\nb\n'

describe('carve#5012 transparent single-line blocks', () => {
  it('keeps list and paragraph layout across a line comment', () => {
    expect(carveToHtml(source)).toBe('<ul>\n  <li>a\nb</li>\n</ul>')
    expect(carveToHtml('para\n%% c\nmore')).toBe('<p>para\nmore</p>')
  })

  it('keeps the comment node at its authored source extent', () => {
    const item = parse(source).children[0]
    expect(item?.type).toBe('list')
    if (item?.type !== 'list') return
    const comment = item.items[0]?.children.find((node) => node.type === 'comment')
    expect(comment).toMatchObject({
      type: 'comment', block: false, content: 'c',
      pos: { startLine: 2, endLine: 2, startColumn: 1, endColumn: 5, startOffset: 4, endOffset: 8 },
    })
  })

  it('writes a comment at its authored column and keeps the visible layout on readback', () => {
    const written = carveToCarve(source)
    expect(written).toBe(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    const quote = '> a\n%% c\nb\n'
    expect(carveToCarve(quote)).toBe(quote)
    expect(carveToHtml(carveToCarve(quote))).toBe(carveToHtml(quote))
  })

  it('registers erased definitions document-wide', () => {
    expect(carveToHtml('[go][r]\n[r]: /u\nmore')).toBe('<p><a href="/u">go</a>\nmore</p>')
    expect(carveToHtml('para\n*[AB]: Alpha Beta\nAB')).toBe('<p>para\n<abbr title="Alpha Beta">AB</abbr></p>')
  })

  it('keeps spans, footnotes and attribute lines block-level', () => {
    expect(carveToHtml('para\n%%%\nhidden\n%%%\nmore')).toBe('<p>para</p>\n<p>more</p>')
    expect(carveToHtml('para\n{.x}\nmore')).toBe('<p>para</p>\n<p class="x">more</p>')
  })

  it('reports parser diagnostics once from the visible layout', () => {
    let reports = 0
    parse('%% c\n::: note\nbody', { onUnclosedContainer: () => { reports++ } })
    expect(reports).toBe(1)
  })
})
