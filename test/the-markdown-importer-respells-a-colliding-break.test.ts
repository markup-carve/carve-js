import { describe, it, expect } from 'vitest'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'
import { carveToCarve } from '../src/index.js'

const value = (md: string) => markdownToCarveWithLosses(md).value

const synthesized = (md: string) =>
  markdownToCarveWithLosses(md).losses.some((loss) => loss.code === 'frontmatter-synthesized')

describe('the Markdown importer respells a break that would open frontmatter (markup-carve/carve-js#2606)', () => {
  it.each([
    ['an empty non-mapping block', '---\n---\nBody\n', '***\n\n***\n\nBody\n'],
    [
      'a rejected block whose body still holds a bare ---',
      '---\nFoo\n---\n\n```\n---\n```\n',
      '***\n\n## Foo\n\n```\n---\n```\n',
    ],
    ['every break in the document, not only the first', '***\n\n***\n\n```\n---\n```\n', '***\n\n***\n\n```\n---\n```\n'],
  ])('writes %s with the canonical writer\'s spelling', (_what, md, expected) => {
    expect(value(md)).toBe(expected)
  })

  it.each([
    ['an empty non-mapping block', '---\n---\nBody\n'],
    ['a rejected block whose body still holds a bare ---', '---\nFoo\n---\n\n```\n---\n```\n'],
    ['a document with real frontmatter and a later break', '---yaml\ntitle: Hi\n---\n\nBody\n\n***\n\nMore\n'],
  ])('round-trips %s through fmt', (_what, md) => {
    const imported = value(md)
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('keeps real frontmatter and leaves its later break spelled ---', () => {
    const md = '---yaml\ntitle: Hi\n---\n\nBody\n\n***\n\nMore\n'
    expect(synthesized(md)).toBe(true)
    expect(value(md)).toBe('---yaml\ntitle: Hi\n---\n\nBody\n\n---\n\nMore\n')
  })

  it('leaves a break that is not at byte 0 alone', () => {
    expect(value('> ***\n\n```\n---\n```\n')).toBe('> ---\n\n```\n---\n```\n')
  })
})
