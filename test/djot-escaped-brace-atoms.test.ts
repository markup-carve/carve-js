import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-escaped-brace-atoms.json'

describe('Djot literal delimiter boundaries', () => {
  for (const row of fixtures) {
    it(row.name, () => {
      const html = carveToHtml(djotToCarve(row.source)).trim()
        .replace(/&nbsp;/g, '\u00a0').replace(/<\/?tbody>/g, '').replace(/>\s+</g, '><')
      expect(html).toBe(row.html.replace(/&nbsp;/g, '\u00a0').replace(/<img alt="([^"]*)" src="([^"]*)">/g, '<img src="$2" alt="$1">'))
    })
  }
})

for (const prefix of ['', '---\nlabel: \0DJOTINVALIDATTR0\0\n---\n\n']) {
  it('preserves user placeholder text and frontmatter', () => {
    const token = '\0DJOTINVALIDATTR0\0'
    const source = `${prefix}${token} w{x}{.c}`
    const converted = djotToCarve(source)
    expect(converted).toContain(token)
    expect(converted).not.toContain('\0DJOTINVALIDATTR1\0')
    if (prefix) expect(converted.startsWith(prefix)).toBe(true)
  })
}

it('keeps repeated raw-brace footnote labels linked to their definition', () => {
  const source = '[^a{b}]: note\n\nsee [^a{b}]'
  const converted = djotToCarve(source)
  const html = carveToHtml(converted)
  expect(html.replace(/>\s+</g, '><')).toContain('<li id="fn1"><p>note')
  expect(html).toContain('href="#fn1"')
  expect(html).not.toContain('href="#fn2"')
  expect(converted).not.toContain('DJOTINVALIDATTR')
})
