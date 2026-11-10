import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const endnotes = (count: number): string => {
  const items = Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return `    <li id="fn${n}">\n      <p><a href="#fnref${n}" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>`
  }).join('\n')
  return `<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n${items}\n  </ol>\n</section>`
}

it.each([
  ['two notes', '[^q]: [^r]: {.x\n            .y}\nz\n\nx[^q][^r]\n', 2],
  ['three notes', '[^q]: [^r]: [^s]: {.x\n                 .y}\nz\n\nx[^q][^r][^s]\n', 3],
])('lets a flush-left follower leave an accepted run under %s', (_name, source, count) => {
  const refs = Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return `<a id="fnref${n}" href="#fn${n}" role="doc-noteref"><sup>${n}</sup></a>`
  }).join('')
  expect(carveToHtml(source)).toBe(`<p>z</p>\n<p>x${refs}</p>\n${endnotes(count)}`)
})

it('lets a paragraph after a nested comment-span closer take its lazy line', () => {
  const source = 'x[^q]\n\n[^q]: [^r]: %%%\n  %%%\n  n\nz\n'
  expect(carveToHtml(source)).toBe('<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
    '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n' +
    '    <li id="fn1">\n      <p>n\nz<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n' +
    '  </ol>\n</section>')
})
