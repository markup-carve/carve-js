import { describe, it, expect } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// CommonMark lets only spaces or tabs follow a setext underline (4.3), a
// thematic break (4.1) or a closing code fence (4.5). Anything else after the
// run, a form feed included, leaves the line as paragraph or code text.
const NOT_PADDING = [
  ['a form feed', '\f'],
  ['a vertical tab', '\v'],
  ['a no-break space', ' '],
] as const

describe('the Markdown importer reads a dash line only up to space and tab padding', () => {
  it('keeps the ticket repro as one paragraph, a rule and a paragraph', () => {
    const carve = markdownToCarve('---yaml\na: 1\n---\f\n...\n***\nu\n')
    expect(carve).toBe('\\-\\-\\-yaml\na: 1\n\\-\\-\\-\f\n...\n\n---\n\nu\n')
    // commonmark.js 0.31.2: <p>---yaml\na: 1\n---\f\n...</p>\n<hr />\n<p>u</p>
    // The ellipsis is Carve's own typography on `...`, not part of this case.
    expect(carveToHtml(carve)).toBe('<p>---yaml\na: 1\n---\f\n…</p>\n<hr>\n<p>u</p>')
  })

  it.each(NOT_PADDING)('closes no frontmatter on `---` followed by %s', (_what, ch) => {
    expect(markdownToCarve(`---yaml\na: 1\n---${ch}\n\nt\n`)).toBe(`\\-\\-\\-yaml\na: 1\n\\-\\-\\-${ch}\n\nt\n`)
    expect(markdownToCarve(`---\na: 1\n---${ch}\nb\n`)).toBe(`---\n\na: 1\n\\-\\-\\-${ch}\nb\n`)
  })

  it.each(NOT_PADDING)('reads no setext underline in `---` or `===` followed by %s', (_what, ch) => {
    expect(markdownToCarve(`a\n---${ch}\n`)).toBe(`a\n\\-\\-\\-${ch}\n`)
    expect(markdownToCarve(`a\n===${ch}\n`)).toBe(`a\n===${ch}\n`)
    expect(markdownToCarve(`- a\n\n  b\n  -${ch}\n`)).toBe(`- a\n\n  b\n  -${ch}\n`)
  })

  it('reads no setext underline behind a leading form feed', () => {
    expect(markdownToCarve('x\n\f---\n')).toBe('x\n\f\\-\\-\\-\n')
  })

  it.each(NOT_PADDING)('reads no thematic break in `***` followed by %s', (_what, ch) => {
    const html = carveToHtml(markdownToCarve(`***${ch}\n`))
    expect(html).toBe(`<p>***${ch === '\u00a0' ? '&nbsp;' : ch}</p>`)
  })

  it.each(NOT_PADDING)('closes no code fence on a fence run followed by %s', (_what, ch) => {
    expect(markdownToCarve(`\`\`\`\nx\n\`\`\`${ch}\ny\n`)).toBe(`\`\`\`\`\nx\n\`\`\`${ch}\ny\n\`\`\`\`\n`)
    expect(markdownToCarve(`~~~\nx\n~~~${ch}\n`)).toBe(`\`\`\`\nx\n~~~${ch}\n\`\`\`\n`)
  })

  it('closes no code fence behind a leading form feed', () => {
    expect(markdownToCarve('```\nx\n\f```\n')).toBe('````\nx\n\f```\n````\n')
  })

  // CommonMark 5.2: a list marker is followed by a space or tab (or the line
  // end); 4.2: so is an ATX heading's opening sequence.
  it.each(NOT_PADDING)('continues a paragraph over a list marker followed by %s', (_what, ch) => {
    expect(carveToHtml(markdownToCarve(`p\n-${ch}x\n`))).toBe(`<p>p\n-${ch === ' ' ? '&nbsp;' : ch}x</p>`)
    expect(carveToHtml(markdownToCarve(`p\n1.${ch}x\n`))).toBe(`<p>p\n1.${ch === ' ' ? '&nbsp;' : ch}x</p>`)
  })

  it.each(NOT_PADDING)('keeps a quoted `#` followed by %s open for a lazy line', (_what, ch) => {
    expect(markdownToCarve(`> #${ch}a\nb\n`)).toBe(`> #${ch}a\n> b\n`)
  })

  it.each([
    ['a closer padded with spaces and tabs', '---yaml\na: 1\n--- \t\n\nt\n', '---yaml\na: 1\n--- \t\n\nt\n'],
    ['a setext h2 underline padded with a tab', 'a\n--- \t\n', '## a\n'],
    ['a setext h1 underline padded with spaces', 'a\n===  \n', '# a\n'],
    ['a thematic break padded with a tab', 'a\n\n* * *\t\n', 'a\n\n---\n'],
    ['a code fence closer padded with spaces', '```\nx\n```  \ny\n', '```\nx\n```\n\ny\n'],
  ])('still reads %s', (_what, md, carve) => {
    expect(markdownToCarve(md)).toBe(carve)
  })
})
