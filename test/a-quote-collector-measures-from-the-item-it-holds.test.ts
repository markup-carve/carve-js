import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

/**
 * The quote collector measures from the item that holds it, and writes what
 * `carve fmt` writes.
 *
 * Both halves are load-bearing and independent: #1946 collects shapes whose
 * reading was already right and whose bytes failed `fmt --check`, and #1947
 * case 1 was a `fmt` fixed point that still read wrong.
 *
 * Every reading below was measured through cmark-gfm 0.29.0.gfm.13.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'

const cases: Array<[string, string, string]> = [
  [
    // carve-js#1946 case 1. The document-level collector already dropped
    // these columns; only the item-held quote carried them through.
    'a quote an item opens drops the quote slack, not the sample',
    lines('- > alpha', sp(2) + '>' + sp(5) + 'code'),
    lines('- > alpha', sp(2) + '> code'),
  ],
  [
    'the same under an ordered marker, whose column is 3',
    lines('1. > alpha', sp(3) + '>' + sp(5) + 'code'),
    lines('1. > alpha', sp(3) + '> code'),
  ],
  [
    // carve-js#1946 case 3: fmt sets a block leaving the item apart from it.
    'a rule leaving a quoted item is set apart from the list',
    lines('> - beta', '> ---'),
    lines('> - beta', '>', '> ---'),
  ],
  [
    'and with a lazy line in between',
    lines('> - beta', '> gamma', '> ---'),
    lines('> - beta', '>' + sp(3) + 'gamma', '>', '> ---'),
  ],
  [
    // carve-js#1947 case 1: `quotedIndentedCodeAt` measured from the quote's
    // content column and knew nothing about the item the quote held, so the
    // fence landed beside the list and the item's two columns became the
    // sample's own indentation.
    'quoted indented code an item holds is fenced at the item column',
    lines('> - alpha', '>', '>' + sp(7) + 'code'),
    lines('> {loose}', '> - alpha', '>', '>' + sp(3) + '```', '>' + sp(3) + 'code', '>' + sp(3) + '```'),
  ],
  [
    'and the item stays open across a line that is still its own',
    lines('> - alpha', '>' + sp(3) + 'more', '>', '>' + sp(7) + 'code'),
    lines('> {loose}', '> - alpha', '>' + sp(3) + 'more', '>', '>' + sp(3) + '```', '>' + sp(3) + 'code', '>' + sp(3) + '```'),
  ],
]

describe('a quote collector measures from the item it holds', () => {
  it.each(cases)('%s', (_label, source, expected) => {
    expect(markdownToCarve(source)).toBe(expected)
  })

  it.each(cases)('%s - and the import is a carve fmt fixed point', (_label, source) => {
    const out = markdownToCarve(source)
    expect(carveToCarve(out)).toBe(out)
  })

  it('keeps the quoted code inside the item, not beside the list', () => {
    // cmark-gfm: <blockquote><ul><li><p>alpha</p><pre><code>code.
    const html = carveToHtml(markdownToCarve(lines('> - alpha', '>', '>' + sp(7) + 'code')))
    expect(html).toMatch(/<li>[\s\S]*<pre><code>code/)
    expect(html).not.toContain('<code>  code')
  })

  it('keeps the item quote reading its paragraph whole', () => {
    // Indented code cannot interrupt a paragraph, so `code` is prose.
    // cmark-gfm: <li><blockquote><p>alpha\ncode</p></blockquote></li>.
    const html = carveToHtml(markdownToCarve(lines('- > alpha', sp(2) + '>' + sp(5) + 'code')))
    expect(html).toMatch(/<blockquote><p>alpha\ncode<\/p>/)
    expect(html).not.toContain('<pre>')
  })

  it('escapes a block opener the dropped columns would expose', () => {
    // Four columns past the item's content the line opens nothing, so the
    // marker is escaped where the line lands rather than read as a quote.
    expect(markdownToCarve(lines('- > alpha', sp(6) + '> code'))).toBe(
      lines('- > alpha', sp(2) + '> \\> code'),
    )
  })

  it('sets nothing apart for a block that stays inside the quoted item', () => {
    expect(markdownToCarve(lines('> - beta', '>' + sp(3) + '# h'))).toBe(
      lines('> - beta', '>' + sp(3) + '# h'),
    )
  })

  it('takes a lone pipe row under a quoted item as paragraph text', () => {
    // No delimiter row, so GFM reads no table and the row continues the item.
    expect(markdownToCarve(lines('> - i', '> |a|b|'))).toBe(lines('> - i', '> \\|a|b|'))
  })
})

describe('the item column stops where the item does', () => {
  it('measures from the quote again after a dedented block closed the item', () => {
    // `>  # h` sits left of the item's content column, so it ends the list and
    // the code below it is the quote's, not the item's.
    // cmark-gfm: <blockquote><ul><li>alpha</li></ul><h1>h</h1><pre><code>  code
    //
    // The heading is written AT the quote's content column. One column in it was
    // no heading in Carve at all - the render held `<p># h</p>` and `fmt`
    // escaped the marker, so the import was not a fixed point of it either
    // (carve-js#2031). The assertion that asked only for the code block could
    // not see that.
    const out = markdownToCarve(lines('> - alpha', '>' + sp(2) + '# h', '>', '>' + sp(7) + 'code'))
    expect(out).toBe(lines('> - alpha', '>', '> # h', '>', '> ```', '>' + sp(3) + 'code', '> ```'))
    expect(carveToHtml(out)).toMatch(/<h1[^>]*>h<\/h1>/)
    expect(carveToHtml(out)).toContain('<code>  code')
  })

  it('measures from the quote for code left of the item content', () => {
    // The item's content starts at column 5, so a line four columns in is
    // outside it and is the quote's own indented code.
    // cmark-gfm: <blockquote><ol><li>i</li></ol><pre><code>alpha.
    expect(markdownToCarve(lines('>' + sp(3) + '1. i', '>', '>' + sp(5) + 'alpha'))).toBe(
      lines('> 1. i', '>', '> ```', '> alpha', '> ```'),
    )
  })

  it('reads a thematic break on the marker line as opening no item', () => {
    // `- ---` is a rule, not a bullet holding one, so there is no item column
    // for the code below to be measured from.
    // cmark-gfm: <blockquote><hr /><pre><code>alpha.
    expect(markdownToCarve(lines('> - ---', '>', '>' + sp(5) + 'alpha'))).toBe(
      lines('> ---', '>', '> ```', '> alpha', '> ```'),
    )
  })

  it('answers the quote column when a line closed an inner item only', () => {
    // Reaching the OUTER item here would be an improvement; this only has to
    // leave the shape where it was, which is at the quote's own column.
    expect(
      markdownToCarve(lines('> - outer', '>' + sp(3) + '- inner', '>' + sp(3) + 'back', '>', '>' + sp(7) + 'code')),
    ).toBe(lines('> - outer', '>' + sp(3) + '- inner', '>' + sp(5) + 'back', '>', '> ```', '>' + sp(3) + 'code', '> ```'))
  })
})
