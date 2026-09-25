import { describe, expect, it } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * A task checkbox is CONTENT, not marker: `- [x] a` is the bullet `- `, whose
 * width is the item's content column, and then `[x] ` which the reader consumes
 * as the item's task state (carve#1701, pinned by
 * `a-task-item-s-checkbox-is-not-part-of-its-marker`). So in Carve the position
 * right after the box is a CONTENT position, and a `>` standing there opens a
 * quote.
 *
 * Markdown's reading stops one step earlier. The item's first block is the
 * paragraph `[ ] > foo`, and the task extension strips the box from a paragraph
 * that has already been decided, so the `>` behind it never opened anything.
 *
 * The importer carried that first line across byte for byte, so the quote,
 * heading or list the box was followed by appeared in the imported document and
 * not in the source. The continuation lines of the SAME paragraph already
 * escaped their marker, which is how it surfaced (carve-js#2023): `- [ ] > foo`
 * over `      > bar` became one quote holding `foo &gt; bar` - two halves of one
 * paragraph reading differently, with a stray `>` in the middle of the quote.
 *
 * `commonmark` 0.31.2 has no task-list extension, so it renders the box as the
 * text it is; every reading below is its output with the box taken off its side
 * and the `<input>` off Carve's. carve-php at `c85ae8df` produces the same bytes
 * as carve-js did before this change, so the defect is filed there too
 * (carve-php#2343) and can be ported rather than rediscovered.
 *
 * What is pinned is the RENDER: the defect was a quote in the document that the
 * source did not spell.
 *
 * The box itself now answers to cmark-gfm 0.29.0.gfm.13 rather than to Carve's
 * own state set (carve-js#2047, carve-js#2048), so a pair GFM does not read is
 * text and moves no content position. The cases below are the ones where both
 * readers see a box; `a-task-pair-outside-gfms-reach-imports-as-text` holds the
 * rest.
 */
const held: Array<[string, string]> = [
  ['a heading marker', '# bar'],
  ['a bullet marker', '- bar'],
  ['a quote marker', '> bar'],
  ['a plus marker', '+ bar'],
  ['an ordered marker', '1. bar'],
  ['a star bullet', '* bar'],
  ['a backtick fence opener', '```'],
  ['a tilde fence opener', '~~~'],
  ['a star thematic break', '***'],
  ['an underscore thematic break', '___'],
  ['a dash thematic break', '---'],
  ['a pipe row', '| bar'],
  ['a link reference definition', '[r]: /u'],
]

describe('a task checkbox does not open the block behind it', () => {
  /**
   * The item's rendered content with the checkbox taken off. Naming the blocks
   * that must be absent is what a first pass did, and it could not see half of
   * them: a bullet behind the box opens a `<ul>` the item's own list already
   * spells, and a fence opens a `<pre>` only once it closes. One paragraph of
   * text leaves no element at all, so the `<` is the assertion.
   */
  const itemBody = (html: string): string => {
    const li = /<li>([\s\S]*)<\/li>/.exec(html)
    expect(li).not.toBeNull()
    return li![1]!.replace(/<input[^>]*>/, '')
  }

  const decode = (text: string): string =>
    text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

  it.each(held)('keeps %s as the text Markdown read after the box', (_name, line) => {
    const html = carveToHtml(markdownToCarve(`- [ ] ${line}\n`))
    expect(html).toContain('<input type="checkbox" disabled')
    // No element, and the text the source had. The text half is not redundant:
    // a link reference definition behind the box opened no element either - it
    // SWALLOWED the line, and an element-only assertion read that as clean.
    expect(itemBody(html)).not.toContain('<')
    expect(decode(itemBody(html)).trim()).toBe(line)
  })

  it('joins the two halves of one paragraph instead of splitting the quote', () => {
    // The reported shape. CommonMark reads `[ ] > foo > bar` as one paragraph.
    expect(markdownToCarve('- [ ] > foo\n      > bar\n')).toBe('- [ ] \\> foo\n  \\> bar\n')
    expect(carveToHtml('- [ ] \\> foo\n  \\> bar\n')).not.toContain('<blockquote')
  })

  it('escapes behind every box spelling GFM reads, and none it does not', () => {
    // The parser's `RE_TASK` takes `[ xX-_>?]` behind a `-` or `*` bullet, and
    // GFM's tasklist extension the first three of those. Only where both read a
    // box does the box survive to move the content position.
    for (const box of ['[ ]', '[x]', '[X]']) {
      expect(markdownToCarve(`- ${box} > foo\n`)).toBe(`- ${box} \\> foo\n`)
      expect(markdownToCarve(`* ${box} > foo\n`)).toBe(`* ${box} \\> foo\n`)
    }
    // The four states GFM has none of are imported as their own text
    // (carve-js#2048), so the pair is escaped as well.
    for (const box of ['[-]', '[_]', '[>]', '[?]']) {
      expect(markdownToCarve(`- ${box} > foo\n`)).toBe(`- \\${box} \\> foo\n`)
      expect(markdownToCarve(`* ${box} > foo\n`)).toBe(`* \\${box} \\> foo\n`)
    }
    // `[y]` is no box, so the `>` behind it was never at a content position.
    expect(markdownToCarve('- [y] > foo\n')).toBe('- [y] > foo\n')
  })

  it('leaves a plus bullet and an ordered marker alone, which take no box', () => {
    // Carve reads neither as a task item, so nothing moved the content position.
    expect(markdownToCarve('1. [ ] > foo\n')).toBe('1. [ ] > foo\n')
    expect(carveToHtml('1. [ ] > foo\n')).not.toContain('<input')
  })

  it('keeps the pair of a box a nested item opens, which GFM does not read', () => {
    // A second container marker on the line puts the list out of the tasklist
    // extension's reach, so the pair is text too (carve-js#2047).
    expect(markdownToCarve('- - [ ] > foo\n')).toBe('- - \\[ ] \\> foo\n')
    expect(carveToHtml(markdownToCarve('- - [ ] > foo\n'))).not.toContain('<input')
  })

  it('leaves an item with no box alone', () => {
    // The plain bullet was always right, and passes on both sides of reverting
    // this change: it is what says the change reached the box rather than the
    // item.
    expect(markdownToCarve('- > foo\n  > bar\n')).toBe('- > foo\n  > bar\n')
    expect(carveToHtml('- > foo\n  > bar\n')).toContain('<blockquote')
  })

  it('leaves a block at the item content column alone', () => {
    // Two columns in is the task item's content column, where Markdown reads a
    // block too, so nothing is escaped there.
    const out = markdownToCarve('- [ ] task\n  ```\n  code\n  ```\n')
    expect(out).toContain('```')
    expect(out).not.toContain('\\`')
  })

  it('writes a fixed point of the formatter', () => {
    for (const line of held.map(([, l]) => l)) {
      const out = markdownToCarve(`- [ ] ${line}\n`)
      expect(carveToCarve(out)).toBe(out)
    }
  })
})
