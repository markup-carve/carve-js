import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()

const note = (body: string) => '<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1">' + body +
  '<p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li></ol></section>'
const ref = '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>'

// carve-js#4023: after a blank, a line below the body column misses the fence's frame (PART 0 S1).
for (const [name, lead, intro] of [
  ['a lone `+`', '[^f]: n\n+', '<p>n</p>'],
  ['a first-block `+`', '[^f]: +', ''],
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

it('keeps a degraded comment fence a line comment in an attached block', () => {
  expect(normalize(carveToHtml('[^f]: n\n+\n%%%\na\n\n  b\n- x\n\nx[^f]\n'))).toBe(normalize(
    `${ref}<section role="doc-endnotes" aria-label="Footnotes"><hr><ol><li id="fn1"><p>n</p><p>a</p>` +
      '<p>b - x<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li></ol></section>',
  ))
})
