import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, htmlToAst, renderHtml, renderMarkdown } from '../src/index.js'

// Same-kind nesting has no Carve source since carve-js#1831, so the trees that
// have it come in through the HTML importer.
const markdownOf = (html: string) => renderMarkdown(htmlToAst(html).value)

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
    expect(markdownOf('<p><em><em>x</em></em></p>')).toBe('<em>*x*</em>\n')
    expect(renderHtml(htmlToAst('<p><em><em>x</em></em></p>').value)).toBe('<p><em><em>x</em></em></p>')
  })

  it('separates strong inside strong, which eight asterisks spell only by luck', () => {
    expect(markdownOf('<p><strong><strong>x</strong></strong></p>')).toBe('<strong>**x**</strong>\n')
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

  // markup-carve/carve-js#1744: a child of a DIFFERENT strength at an edge
  // nests, so the run stays and the engines write the same bytes. The ruling
  // recorded on markup-carve/carve-js#1736 picks the plain spelling.
  it('keeps the run when a strong closes an emphasis', () => {
    expect(carveToMarkdown('{/italic *bold*/}\n')).toBe('*italic **bold***\n')
  })

  it('keeps the run when an emphasis closes a strong', () => {
    expect(carveToMarkdown('{*bold /italic/*}\n')).toBe('**bold *italic***\n')
  })

  it('keeps the run when the child opens the content instead', () => {
    expect(carveToMarkdown('{/*bold* italic/}\n')).toBe('***bold** italic*\n')
  })

  it('keeps it intraword, where the run has an alphanumeric outside it', () => {
    expect(carveToMarkdown('a{/x *y*/}b\n')).toBe('a*x **y***b\n')
  })

  it('re-spells an equal-strength child that opens the content', () => {
    expect(markdownOf('<p><em><em>x</em> tail</em></p>')).toBe('<em>*x* tail</em>\n')
  })

  it('re-spells an equal-strength child that closes it', () => {
    expect(markdownOf('<p><em>head <em>x</em></em></p>')).toBe('<em>head *x*</em>\n')
  })

  it('re-spells a literal the writer did not escape at the edge', () => {
    expect(markdownOf('<p><em><em>**x</em></em></p>')).toBe('<em>*\\*\\*x*</em>\n')
  })
})
