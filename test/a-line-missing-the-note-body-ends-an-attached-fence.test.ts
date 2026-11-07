import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()

const note = (body: string) => '<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1">' + body +
  '<p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li></ol></section>'
const ref = '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>'

// carve-js#4023: after a blank, a line below the body column misses the fence's frame (PART 0 S1).
for (const [name, lead, intro] of [
  ['a lone `+`', '[^f]: n\n+', '<p>n</p>'],
] as const) {
  it(`ends a fence attached by ${name} on a column-0 line after a blank`, () => {
    expect(normalize(carveToHtml(`${lead}\n\`\`\`\na\n\n  b\nsee\n\nx[^f]\n`))).toBe(normalize(
      `<p>see</p>${ref}${note(`${intro}<pre><code>a\n\nb\n</code></pre>`)}`,
    ))
  })

  it(`opens a list on a column-0 marker after a fence attached by ${name}`, () => {
    expect(normalize(carveToHtml(`${lead}\n~~~\na\n\n  b\n- x\n\nx[^f]\n`))).toBe(normalize(
      `<ul><li>x</li></ul>${ref}${note(`${intro}<pre><code>a\n\nb\n</code></pre>`)}`,
    ))
  })
}

// A first-block `+` fence with no closer ends at its first blank, and the note resumes (carve#5404).
const resumedNote = (body: string) => '<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1">' +
  body + '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li></ol></section>'

it('ends a fence attached by a first-block `+` at its first blank', () => {
  expect(normalize(carveToHtml('[^f]: +\n```\na\n\n  b\nsee\n\nx[^f]\n'))).toBe(normalize(
    `${ref}${resumedNote('<pre><code>a\n</code></pre><p>b\nsee')}`,
  ))
})

it('opens a list on a column-0 marker after a first-block `+` fence ended at its blank', () => {
  expect(normalize(carveToHtml('[^f]: +\n~~~\na\n\n  b\n- x\n\nx[^f]\n'))).toBe(normalize(
    `<ul><li>x</li></ul>${ref}${resumedNote('<pre><code>a\n</code></pre><p>b')}`,
  ))
})

// An unclosed `%%%` at column 0 hides the rest of the document (carve#4907).
it('hides the rest of the document behind an unclosed comment fence in an attached block', () => {
  expect(carveToHtml('[^f]: n\n+\n%%%\na\n\n  b\n- x\n\nx[^f]\n')).toBe('')
})
