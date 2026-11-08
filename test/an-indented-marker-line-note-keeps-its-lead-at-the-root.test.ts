import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = (n: number, text: string): string =>
  `<li id="fn${n}">\n      <p>${text}<a href="#fnref${n}" role="doc-backlink" aria-label="Back to reference">↩</a></p>`

it('keeps a text definition in an indented note lead with its body (carve-js#4728)', () => {
  for (const indent of [' ', '  ', '   ']) {
    const html = carveToHtml(`${indent}[^m]: +\n${indent}[^n]: d\n${indent}para\n\nx[^m][^n]\n`)
    expect(html.startsWith('<p>x')).toBe(true)
    expect(html).toContain(note(1, ''))
    expect(html).toContain(note(2, 'd\npara'))
  }
})

it('attaches the block past a refused plus definition in an indented lead (carve-js#4728)', () => {
  const html = carveToHtml(' [^m]: +\n [^n]: +\n para\n\nx[^m][^n]\n')
  expect(html.startsWith('<p>x')).toBe(true)
  expect(html).toContain(note(1, 'para'))
  expect(html).toContain(note(2, ''))
})
