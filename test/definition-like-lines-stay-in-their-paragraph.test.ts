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

  it.each([2, 3])('closes the paragraph for a quoted definition with %i spaces', (spaces) => {
    expect(html(`>${' '.repeat(spaces)}[d]: u\n)\n`)).toBe(
      '<blockquote>\n\n</blockquote>\n<p>)</p>',
    )
  })

  it('closes the paragraph for a definition at the quote content column', () => {
    expect(html('> [d]: u\n)\n')).toBe('<blockquote>\n\n</blockquote>\n<p>)</p>')
  })

  // CARVE-P0-009: a link definition leaves the item no open paragraph, so `)`
  // closes the list and no surviving frame, the quote included, adopts it.
  it.each([
    ['> - a\n>   [d]: u\n)\n', 'ul'],
    ['> 1. a\n>    [d]: u\n)\n', 'ol'],
    ['> - a\n>\n>   [d]: u\n)\n', 'ul'],
  ])('ends the quote after a link definition inside a quoted list (%j)', (source, tag) => {
    expect(html(source)).toBe(
      `<blockquote>\n  <${tag}>\n    <li>a</li>\n  </${tag}>\n</blockquote>\n<p>)</p>`,
    )
  })

  // The note's open paragraph takes the line lazily (carve#3885).
  it('folds the line into a footnote definition inside a quoted list', () => {
    expect(html('> - a\n>   [^f]: u\n)\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>',
    )
  })

  it('collects an underindented definition below a tight-list paragraph', () => {
    expect(html('* : |\n [f]: t\n')).toBe('<ul>\n  <li>: |</li>\n</ul>')
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
