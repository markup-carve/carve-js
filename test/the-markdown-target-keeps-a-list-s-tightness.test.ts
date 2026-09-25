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
})
