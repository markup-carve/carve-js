import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

/**
 * Carve has no indented code block, so code an item holds is written as the
 * item's fence. Carried through instead, the code and its own delimiters read
 * as prose, which is the loss markup-carve/carve-js#1947 case 2 and
 * markup-carve/carve-js#1952 case 3 both describe.
 *
 * Readings measured through cmark-gfm 0.29.0.gfm.13.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'

describe('indented code an item holds after a quote', () => {
  it('fences code under a quote the item holds', () => {
    // cmark-gfm: <li>a<blockquote><h1>h</h1></blockquote><pre><code>code.
    const out = markdownToCarve(lines('- a', sp(2) + '> # h', sp(6) + 'code'))
    expect(out).toBe(lines('- a', sp(2) + '> # h', sp(2) + '```', sp(2) + 'code', sp(2) + '```'))
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toMatch(/<blockquote>[\s\S]*<pre><code>code/)
  })

  it('fences code after the item quote closes', () => {
    // cmark-gfm: <li><blockquote><p>alpha</p></blockquote><pre><code>code.
    // The empty `>` line is not an fmt fixed point on its own, here or at the
    // document level, so this pins the reading rather than the bytes.
    const out = markdownToCarve(lines('- > alpha', sp(2) + '>', sp(6) + 'code'))
    expect(out).toBe(lines('- > alpha', sp(2) + '>', sp(2) + '```', sp(2) + 'code', sp(2) + '```'))
    const html = carveToHtml(out)
    expect(html).toMatch(/<blockquote>[\s\S]*<pre><code>code/)
    expect(html).not.toContain('<blockquote><p>alpha</p></blockquote>\n    code')
  })

  it('leaves a line four columns in that continues a paragraph', () => {
    // Indented code cannot interrupt a paragraph, so this is prose.
    // cmark-gfm: <li>a\ncode</li>.
    expect(markdownToCarve(lines('- a', sp(6) + 'code'))).toBe(lines('- a', sp(2) + 'code'))
  })

  it('leaves a line four columns in under a quote paragraph', () => {
    // Same rule inside the quote the item holds.
    // cmark-gfm: <li><blockquote><p>alpha\ncode</p></blockquote></li>.
    const out = markdownToCarve(lines('- > alpha', sp(6) + 'code'))
    expect(out).toBe(lines('- > alpha', sp(2) + '> code'))
    expect(carveToHtml(out)).not.toContain('<pre>')
  })
})

describe('marker padding collapses where the item carries its content along', () => {
  it('collapses when the next block sits at the item content column', () => {
    // cmark-gfm: <li><p>a</p><p>b</p></li>. `ListMarkers` moves `b` with the
    // item, so the padding fmt collapses is free to collapse
    // (markup-carve/carve-js#1952 case 4).
    const out = markdownToCarve(lines('-' + sp(2) + 'a', '', sp(3) + 'b'))
    expect(out).toBe(lines('- a', '', sp(2) + 'b'))
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toMatch(/<li><p>a<\/p>[\s\S]*<p>b<\/p>/)
  })

  it('keeps it where the next block is left of that column', () => {
    // `b` is outside the item, and nothing moves it, so collapsing would pull
    // it in. cmark-gfm: <ul><li>a</li></ul><p>b</p>.
    const out = markdownToCarve(lines('-' + sp(2) + 'a', '', sp(2) + 'b'))
    expect(out).toBe(lines('-' + sp(2) + 'a', '', sp(2) + 'b'))
    expect(carveToHtml(out)).toMatch(/<\/ul>[\s\S]*<p>b<\/p>/)
  })
})

describe('an empty code block carries the blank line fmt writes', () => {
  it.each([
    ['at the document level', '```\n```\n', lines('```', '', '```')],
    ['inside a list item', '- ```\n  ```\n', lines('- ```', '', sp(2) + '```')],
    ['inside a quoted item, where the blank carries the marker', '> - ```\n>   ```\n', lines('> - ```', '>', sp(0) + '>' + sp(3) + '```')],
    ['with an info string', '```js\n```\n', lines('```js', '', '```')],
  ])('%s', (_label, source, expected) => {
    const out = markdownToCarve(source)
    expect(out).toBe(expected)
    expect(carveToCarve(out)).toBe(out)
    // Both spellings render the same empty block, so this is bytes only.
    expect(carveToHtml(out)).toBe(carveToHtml(source))
  })

  it('leaves a fence that holds something alone', () => {
    expect(markdownToCarve(lines('```', 'code', '```'))).toBe(lines('```', 'code', '```'))
  })
})
