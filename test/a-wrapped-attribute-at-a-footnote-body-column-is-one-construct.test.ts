import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A wrapped attribute opened at a footnote body's column takes its later lines at
// any column, ends the paragraph above it and attaches to the next block
// (PART 9 §15 A1 and A5, §24 C3). Expectations are the spec model's
// (markup-carve/carve#4104).
const note = (body: string): string =>
  '<p><a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  body +
  '\n    </li>\n  </ol>\n</section>'
const backlink = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'

describe('a wrapped attribute at a footnote body column', () => {
  it.each([
    [
      'a closer at column 0 ends the run',
      '[^f]: d\n  {.c\n}\n  x\n\n[^f]\n',
      note(`      <p>d</p>\n      <p class="c">x${backlink}</p>`),
    ],
    [
      'a closer in the band below the body column',
      '[^f]: d\n  {.c\n }\n  x\n\n[^f]\n',
      note(`      <p>d</p>\n      <p class="c">x${backlink}</p>`),
    ],
    [
      'a run of three lines',
      '[^f]: d\n  {.c\nk=v\n}\n  x\n\n[^f]\n',
      note(`      <p>d</p>\n      <p class="c" k="v">x${backlink}</p>`),
    ],
    [
      'inside a quote',
      '> [^f]: d\n>   {.c\n> }\n>   x\n\n[^f]\n',
      '<blockquote>\n\n</blockquote>\n' + note(`      <p>d</p>\n      <p class="c">x${backlink}</p>`),
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
