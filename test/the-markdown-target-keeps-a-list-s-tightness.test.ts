import { describe, expect, it } from 'vitest'
import { carveToMarkdown, parse, renderHtml } from '../src/index.js'
import { markdownToCarve } from '../src/markdown-migrate.js'

// The ruled property is the tightness that survives a re-parse, not the bytes,
// so every case below reads its own output back before asserting
// (markup-carve/carve#2281).
const readBack = (source: string) => {
  const markdown = carveToMarkdown(source)
  const carve = markdownToCarve(markdown)
  return { markdown, list: parse(carve).children[0], html: renderHtml(parse(carve)) }
}

describe("the Markdown target keeps a list's tightness", () => {
  it('keeps a tight item tight above a nested block quote', () => {
    const source = '- a\n  > - x\n  - m\n'
    const { markdown, list, html } = readBack(source)

    expect(markdown).toBe('- a\n  > - x\n  >   \\- m\n')
    expect(list).toMatchObject({ type: 'list', tight: true })
    expect(html).toBe(renderHtml(parse(source)))
  })

  it('keeps a flat loose list loose', () => {
    const source = '- a\n\n- b\n'
    const { markdown, list, html } = readBack(source)

    expect(markdown).toBe('- a\n\n- b\n')
    expect(list).toMatchObject({ type: 'list', tight: false })
    expect(html).toBe(renderHtml(parse(source)))
  })

  it('separates the items of a loose ordered list too', () => {
    const { markdown, list } = readBack('1. a\n\n2. b\n')

    expect(markdown).toBe('1. a\n\n2. b\n')
    expect(list).toMatchObject({ type: 'list', tight: false })
  })

  it('keeps the separator where an ordered sub-list cannot interrupt', () => {
    expect(readBack('- a\n  3. b\n').markdown).toBe('- a\n\n  3. b\n')
  })

  it('keeps the separator below a quote, which would absorb the block under it', () => {
    expect(readBack('- a\n  > q\n\n  b\n').markdown).toBe('- a\n\n  > q\n\n  b\n')
  })

  it('keeps the separator between two sibling quotes, which would merge', () => {
    const { markdown, list } = readBack('- x\n+\n> q\n+\n> q\n')

    expect(markdown).toBe('- x\n  > q\n\n  > q\n')
    expect(list).toMatchObject({
      items: [{ children: [{ type: 'paragraph' }, { type: 'block_quote' }, { type: 'block_quote' }] }],
    })
  })

  // `CARVE-P11-047` asks whether the block below OPENS with something that
  // interrupts a paragraph, and the nested list and block quote the clause names
  // are examples of that property rather than the whole of it (carve-js#2056). An
  // ATX heading, a fenced code block and a GFM table interrupt one as well, in
  // cmark-gfm 0.29.0.gfm.13 and in this repo's own reader alike, and the question
  // is asked per PAIR: a heading opens under a quote as readily as under a
  // paragraph, because a line that opens a block is not lazy continuation.
  describe('above an opener the clause did not spell out', () => {
    it('drops the separator above an ATX heading', () => {
      const { markdown, list, html } = readBack('- a\n  # h\n')

      expect(markdown).toBe('- a\n  # h\n')
      expect(list).toMatchObject({ type: 'list', tight: true })
      expect(html).toBe(renderHtml(parse('- a\n  # h\n')))
    })

    it('drops it above a fenced code block', () => {
      const { markdown, list, html } = readBack('- a\n  ```\n  x\n  ```\n')

      expect(markdown).toBe('- a\n  ```\n  x\n  ```\n')
      expect(list).toMatchObject({ type: 'list', tight: true })
      expect(html).toBe(renderHtml(parse('- a\n  ```\n  x\n  ```\n')))
    })

    it('drops it above a table, whose delimiter row promotes the row above it', () => {
      const { markdown, list, html } = readBack('- one\n  |= H |\n  | x |\n')

      expect(markdown).toBe('- one\n  | H |\n  | --- |\n  | x |\n')
      expect(list).toMatchObject({ type: 'list', tight: true })
      expect(html).toBe(renderHtml(parse('- one\n  |= H |\n  | x |\n')))
    })

    it('drops it under a block quote, which does not absorb a heading', () => {
      const { markdown, list, html } = readBack('- intro\n  > quote\n  # heading\n')

      expect(markdown).toBe('- intro\n  > quote\n  # heading\n')
      expect(list).toMatchObject({ type: 'list', tight: true })
      expect(html).toBe(renderHtml(parse('- intro\n  > quote\n  # heading\n')))
    })

    it('drops it at every pair of a run', () => {
      expect(readBack('- a\n  # h\n  - m\n').markdown).toBe('- a\n  # h\n  - m\n')
    })

    it('reads the seam off the written text, not the sibling index', () => {
      // A comment writes nothing here, so the block the separator hangs off is
      // two children back and only the written text says so (carve-php#2406).
      const { markdown, list } = readBack('- a\n  %% c\n  |= H |\n  | x |\n')

      expect(markdown).toBe('- a\n  | H |\n  | --- |\n  | x |\n')
      expect(list).toMatchObject({ type: 'list', tight: true })
    })
  })

  // The separator each case below keeps is load-bearing, and `glued` is what the
  // writer would emit without it. Every reading asserted there is cmark-gfm's
  // too, except where the comment says otherwise.
  describe('where the separator carries the meaning', () => {
    const glued = (markdown: string) => renderHtml(parse(markdownToCarve(markdown)))

    it('keeps it above a thematic break, which a paragraph line turns into a setext heading', () => {
      expect(readBack('- a\n  ---\n').markdown).toBe('- a\n\n  ---\n')
      expect(glued('- a\n  ---\n')).toContain('<h2>a</h2>')
    })

    it('keeps it above a lone dash, a setext underline of its own', () => {
      // The dash is paragraph text, so PART 11 section 8g T3 escapes it; the
      // separator still keeps it off the line above.
      expect(readBack('- a\n+\n-\n').markdown).toBe('- a\n\n  \\-\n')
      expect(glued('- a\n  -\n')).toContain('<h2>a</h2>')
    })

    it('gives a headerless table the header row that makes it a table', () => {
      // PART 11 section 10n: with its empty header row the table opens under the
      // item text like any other table.
      expect(readBack('- item\n  | a | b |\n').markdown).toBe('- item\n  |  |  |\n  | --- | --- |\n  | a | b |\n')
      expect(glued('- item\n  | a | b |\n')).toContain('item\n| a | b |')
    })

    it('keeps it between two tables, where the second would read as more rows', () => {
      // cmark-gfm 0.29.0.gfm.13 on the glued spelling: one table of four body
      // rows, the second delimiter row among them as a `---` data cell. This
      // repo's reader keeps the two tables apart, so it cannot witness this one.
      expect(readBack('- x\n+\n| a |\n|---|\n| b |\n+\n| a |\n|---|\n| b |\n').markdown).toBe(
        '- x\n  | a |\n  | --- |\n  | b |\n\n  | a |\n  | --- |\n  | b |\n',
      )
    })

    it('keeps it above a table under a quote, which takes the row lazily', () => {
      // cmark-gfm reads the glued spelling with all three rows inside the quote's
      // own paragraph; this repo's reader puts the table after the quote.
      expect(readBack('- x\n+\n> q\n+\n| a |\n|---|\n| b |\n').markdown).toBe(
        '- x\n  > q\n\n  | a |\n  | --- |\n  | b |\n',
      )
    })
  })
})
