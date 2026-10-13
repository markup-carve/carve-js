import { expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

const labels = ['a\t%% hidden', 'a\tb', 'a\t\tb', '\ta', 'a\t', '\t', 'a *b\tc*', 'a *\tb*', 'a *b\t*']

for (const kind of ['', 'note ', 'figure ']) for (const label of labels) {
  it(`keeps label tabs in ${JSON.stringify(kind)}${JSON.stringify(label)}`, () => {
    const source = `::: ${kind}[${label}]\nbody\n:::\n`
    const html = carveToHtml(source)
    const imported = htmlToCarve(html, { mode: 'roundtrip' })
    expect(imported.value).toContain('\t')
    expect(carveToHtml(imported.value)).toBe(html)
    expect(imported.report.diagnostics).toEqual([])
    expect(htmlToCarve(carveToHtml(imported.value), { mode: 'roundtrip' }).value).toBe(imported.value)
  })
}

it('still collapses tabs in an ordinary imported paragraph', () => {
  expect(htmlToCarve('<p>a\tb</p>', { mode: 'roundtrip' }).value).toBe('a b\n')
})

it('still collapses label spaces and HTML line breaks', () => {
  const imported = htmlToCarve('<div><p class="div-label">a  b\nc</p><p>body</p></div>', { mode: 'roundtrip' })
  expect(imported.value).toBe('::: [a b c]\nbody\n:::\n')
})

it('restores ordinary whitespace handling when a label lift is refused', () => {
  const imported = htmlToCarve('<div><p class="div-label">a\t]b</p><p>c\td</p></div>', { mode: 'roundtrip' })
  expect(imported.value).not.toContain('\t')
  expect(imported.value).toContain('c d')
})

it('collapses tab indentation around label HTML line breaks', () => {
  const html = '<div><p class="div-label">\n\t\tLabel\n\t</p><p>body</p></div>'
  expect(htmlToCarve(html, { mode: 'roundtrip' }).value).toBe('::: [Label]\nbody\n:::\n')
})
