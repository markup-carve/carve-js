import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown } from '../src/index.js'

/**
 * carve-js#1717. A parent and its only child that spell their delimiters with
 * the same character emit one run on each side, and the reader re-pairs it by
 * its own rule. Where the two strengths DIFFER that is the round-trip
 * normalization list's second entry and the document is the same; where they
 * are EQUAL the runs collapse into one element of the wrong kind.
 *
 * Read back with markdown-it-py 3.0.0 (`commonmark` preset, `strikethrough`
 * enabled) and pulldown-cmark 0.13.4; both give the same answer here.
 */
describe('a nested run of the same character is re-spelled', () => {
  it('separates emphasis inside emphasis, which four asterisks read as one strong', () => {
    expect(carveToMarkdown('/{/x/}/\n')).toBe('<em>*x*</em>\n')
    expect(carveToHtml('/{/x/}/\n')).toBe('<p><em><em>x</em></em></p>')
  })

  it('separates strong inside strong, which eight asterisks spell only by luck', () => {
    expect(carveToMarkdown('*{*x*}*\n')).toBe('<strong>**x**</strong>\n')
  })

  it('leaves a bold-italic alone, whose two strengths commute', () => {
    expect(carveToMarkdown('/*x*/\n')).toBe('***x***\n')
    expect(carveToMarkdown('/{*x*}/\n')).toBe('***x***\n')
  })

  it('leaves a nesting whose two spellings share no character alone', () => {
    expect(carveToMarkdown('/{~x~}/\n')).toBe('*~~x~~*\n')
  })

  it('does not count an escaped edge character as reaching the run', () => {
    expect(carveToMarkdown('{/x\\*/}\n')).toBe('*x\\**\n')
  })
})
