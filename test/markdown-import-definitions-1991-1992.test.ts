import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

describe('Markdown import definition placement', () => {
  // markup-carve/carve-js#1991
  it('keeps an item whose only content is an empty-destination definition', () => {
    const imported = markdownToCarve('- [x]: <>\n- b\n')
    expect(imported).toBe('- %%\n- b\n')
    expect(carveToHtml(imported)).toBe('<ul>\n  <li></li>\n  <li>b</li>\n</ul>')
  })

  it('spells that item the way a non-empty destination already does', () => {
    expect(markdownToCarve('- [x]: <>\n- b\n')).toBe(markdownToCarve('- [x]: /u\n- b\n').split('\n\n')[0] + '\n')
  })

  it.each([
    ['only item', '- [x]: <>\n', '- %%\n'],
    ['after a paragraph', 'a\n\n- [x]: <>\n- b\n', 'a\n\n- %%\n- b\n'],
    ['second item', '- one\n- [x]: <>\n', '- one\n- %%\n'],
  ])('keeps the item: %s', (_name, source, expected) => {
    expect(markdownToCarve(source)).toBe(expected)
  })

  it('leaves the rest of the item when the definition is not all it holds', () => {
    expect(markdownToCarve('- [x]: <>\n  more\n- b\n')).toBe('- %%\n  more\n- b\n')
  })

  // markup-carve/carve-js#1992
  it('writes a footnote definition last, where carve fmt writes it', () => {
    const imported = markdownToCarve('a[^1]\n\n[^1]: note\n\nb\n')
    expect(imported).toBe('a[^1]\n\nb\n\n[^1]: note\n')
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('keeps the order the source introduced the definitions in', () => {
    expect(markdownToCarve('a[^1]\n\nb[^2]\n\n[^2]: two\n\n[^1]: note\n\nc\n'))
      .toBe('a[^1]\n\nb[^2]\n\nc\n\n[^2]: two\n\n[^1]: note\n')
  })

  it('moves a footnote body that runs over more than one line', () => {
    expect(markdownToCarve('a[^1]\n\n[^1]: note\n    more\n\nb\n'))
      .toBe('a[^1]\n\nb\n\n[^1]: note\n    more\n')
  })

  it('leaves a definition the source already wrote last', () => {
    expect(markdownToCarve('a[^1]\n\nb\n\n[^1]: note\n')).toBe('a[^1]\n\nb\n\n[^1]: note\n')
  })

  it('leaves a document that is nothing but definitions alone', () => {
    expect(markdownToCarve('[^1]: note\n')).toBe('[^1]: note\n')
  })

  it('does not read a definition-shaped line inside a fence as one', () => {
    expect(markdownToCarve('```\n[^1]: not a def\n```\n\nb\n')).toBe('```\n[^1]: not a def\n```\n\nb\n')
  })

  it('leaves a definition a container holds where the container holds it', () => {
    expect(markdownToCarve('> a[^1]\n>\n> [^1]: note\n>\n> b\n')).toBe('> a[^1]\n>\n> [^1]: note\n>\n> b\n')
  })

  it('writes the footnote definitions after the link definitions', () => {
    const imported = markdownToCarve('a[^1] [x]\n\n[^1]: note\n\n[x]: /u\n\nb\n')
    expect(imported).toBe('a[^1] [x][]\n\nb\n\n[x]: /u\n\n[^1]: note\n')
    expect(carveToCarve(imported)).toBe(imported)
  })
})
