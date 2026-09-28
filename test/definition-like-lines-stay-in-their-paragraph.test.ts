import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

// Expected HTML checked against the spec oracle at e24e38e99 (carve-js#2236).
describe('definition-like lines stay in their paragraph', () => {
  const html = (source: string) => carveToHtml(source).trim()

  it('does not collect a definition behind an unfinished brace and folded marker', () => {
    const source = '[][d]\n{\n- [d]: u\n'
    expect(html(source)).toBe('<p>[][d]\n{\n- [d]: u</p>')
    expect(JSON.stringify(parse(source))).not.toContain('link_reference_definition')
  })

  it.each([2, 3])('keeps a quoted definition with %i spaces open for lazy prose', (spaces) => {
    expect(html(`>${' '.repeat(spaces)}[d]: u\n)\n`)).toBe(
      '<blockquote><p>[d]: u\n)</p></blockquote>',
    )
  })

  it('closes the paragraph for a definition at the quote content column', () => {
    expect(html('> [d]: u\n)\n')).toBe('<blockquote>\n\n</blockquote>\n<p>)</p>')
  })

  it.each([
    ['> - a\n>   [d]: u\n)\n', 'ul'],
    ['> 1. a\n>    [d]: u\n)\n', 'ol'],
    ['> - a\n>\n>   [d]: u\n)\n', 'ul'],
    ['> - a\n>   [^f]: u\n)\n', 'ul'],
  ])('matches the oracle for a definition inside a quoted list (%j)', (source, tag) => {
    expect(html(source)).toBe(
      `<blockquote>\n  <${tag}>\n    <li>a</li>\n  </${tag}>\n  <p>)</p>\n</blockquote>`,
    )
  })

  it('keeps an underindented definition in the same tight-list paragraph', () => {
    expect(html('* : |\n [f]: t\n')).toBe('<ul>\n  <li>: |\n[f]: t</li>\n</ul>')
  })

  it.each(['', '  '])('collects a definition at an eligible column (%j)', (indent) => {
    expect(html(`* : |\n${indent}[f]: t\n`)).toBe('<ul>\n  <li>: |</li>\n</ul>')
  })

  it.each(['{.a}', '{.a\n.b}'])('lets valid attributes end prose (%j)', (attributes) => {
    const classes = attributes.includes('.b') ? 'a b' : 'a'
    expect(html(`[][d]\n${attributes}\n- [d]: u\n`)).toBe(
      `<p><a href="u"></a></p>\n<ul class="${classes}">\n  <li></li>\n</ul>`,
    )
  })

  it('collects a definition after a blank ends the unfinished brace paragraph', () => {
    expect(html('[][d]\n{\n\n[d]: u\n')).toBe('<p><a href="u"></a>\n{</p>')
  })
})
