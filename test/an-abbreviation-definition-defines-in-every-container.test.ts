import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve, parse, renderCarve } from '../src/index.js'

// carve#4865: `*[A]: b` reads as a link definition does in every container, with document scope.
const use = '\n\nA\n'
const defined = '<p><abbr title="b">A</abbr></p>'

describe('an abbreviation definition in every container', () => {
  it.each([
    ['a quote', '> *[A]: b'],
    ['an item', '- n\n  *[A]: b'],
    ['an item past a blank', '- n\n\n  *[A]: b'],
    ['a nested item', '- a\n  - b\n    *[A]: b'],
    ['a div', ':::\n*[A]: b\n:::'],
    ['a description', ':: t\n: d\n  *[A]: b'],
    ['a note body', '[^n]: x\n    *[A]: b'],
    ['a note opening line', '[^n]: *[A]: b'],
    ['an item on a note opening line', '[^n]: - *[A]: b'],
    ['a quote on a note opening line', '[^n]: > *[A]: b'],
  ])('defines from %s', (_, source) => {
    expect(carveToHtml(source + use)).toContain(defined)
  })

  it('stays inert in a fence a note opens on its marker line', () => {
    expect(carveToHtml('[^n]: ```\n  *[A]: b\n  ```\n\nr[^n] A\n')).not.toContain('<abbr')
    expect(carveToHtml('[^n]: ```\n  [r]: /u\n  ```\n\nr[^n] [t][r]\n')).not.toContain('href="/u"')
  })

  it('registers a link definition on a note opening line the same way', () => {
    expect(carveToHtml('[^n]: [r]: /u\n\n[t][r]\n')).toContain('<a href="/u">t</a>')
    const node = parse('[^n]: [r]: /u\n\n[t][r]\n').children.find(child => child.type === 'link_reference_definition')!
    expect(node.pos).toMatchObject({ startColumn: 7, startOffset: 6 })
  })

  it('hoists exactly one node per definition, in source order', () => {
    const doc = parse('*[X]: y\n\n> *[A]: b\n\nz\n')
    expect(doc.children.map(node => node.type)).toEqual(['abbreviation_def', 'block_quote', 'abbreviation_def', 'paragraph'])
  })

  it('starts the hoisted span at its marker, not at the container prefix', () => {
    const pos = (source: string) => parse(source).children.find(node => node.type === 'abbreviation_def')!.pos!
    expect(pos('> *[A]: b\n')).toMatchObject({ startColumn: 3, startOffset: 2 })
    expect(pos(':: t\n:  - a\n    *[H]: x\n')).toMatchObject({ startColumn: 5, startOffset: 16 })
  })

  it('writes a note whose nested list holds only a definition', () => {
    for (const source of ['[^n]: - - *[A]: b\n\nr[^n]\n', '[^n]: - - {empty}\n\nr[^n]\n']) {
      const written = renderCarve(parse(source))
      expect(carveToHtml(written)).toBe(carveToHtml(source))
      expect(renderCarve(parse(written))).toBe(written)
    }
  })

  it('keeps the definition through fmt', () => {
    const source = '> *[A]: b\n\nA\n'
    const written = renderCarve(parse(source))
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(renderCarve(parse(written))).toBe(written)
  })

  it.each([
    ['> *[A]: b\n', '> \\*[A]: b\n'],
    ['- n\n\n  *[A]: b\n', '- n\n\n  \\*[A]: b\n'],
    ['> - *[A]: b\n', '> - \\*[A]: b\n'],
  ])('stays literal from Markdown with abbreviations off: %j', (markdown, carve) => {
    expect(markdownToCarve(markdown, { abbreviations: false })).toBe(carve)
  })
})
