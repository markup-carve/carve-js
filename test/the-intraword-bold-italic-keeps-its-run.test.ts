import { describe, expect, it } from 'vitest'
import { carveToMarkdown, htmlToAst, renderMarkdown } from '../src/index.js'

/**
 * carve-js#1736. The flanking pass read the CHILD'S delimiter at the edge of
 * the core as the character inside the run, so `a ***x***b` looked unable to
 * flank. It is part of the run the reader lexes, not content beside it.
 *
 * Read back with markdown-it-py 3.0.0 (`commonmark` preset, `strikethrough`
 * enabled) and pulldown-cmark 0.13.4.
 */
describe('the intraword bold-italic keeps its run', () => {
  it.each([
    ['a /*x*/b', 'a ***x***b'],
    ['a/*x*/b', 'a***x***b'],
    ['a /*~x*/b', 'a ***\\~x***b'],
    ['a /**x*/b', 'a ***\\*x***b'],
    ['a {*{/x/}*}b', 'a ***x***b'],
  ])('writes %j as a run', (source, expected) => {
    expect(carveToMarkdown(`${source}\n`)).toBe(`${expected}\n`)
  })

  it.each([
    ['a /*x~*/b', 'a <strong>*x\\~*</strong>b'],
    ['a /*x!*/b', 'a <strong>*x!*</strong>b'],
    ['a/*~x*/b', 'a<strong>*\\~x*</strong>b'],
  ])('keeps the fallback in %j, where the run cannot flank', (source, expected) => {
    // `a ***x\~***b` and `a***\~x***b` come back as literal text in both
    // readers: a run whose inside character is punctuation needs a neighbour
    // that is whitespace or punctuation, and a word character is neither.
    expect(carveToMarkdown(`${source}\n`)).toBe(`${expected}\n`)
  })

  // Same-kind nesting has no Carve source since carve-js#1831, so the tree
  // comes in through the HTML importer.
  it('leaves a same-strength nesting on its inline-HTML form', () => {
    expect(renderMarkdown(htmlToAst('<p>a <em><em>x</em></em> b</p>').value)).toBe('a <em>*x*</em> b\n')
  })
})
