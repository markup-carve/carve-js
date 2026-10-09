import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-escaped-brace-atoms.json'

describe('Djot literal delimiter boundaries', () => {
  for (const row of fixtures) {
    it(row.name, () => {
      const html = carveToHtml(djotToCarve(row.source)).trim()
        .replace(/&nbsp;/g, '\u00a0').replace(/<\/?tbody>/g, '').replace(/>\s+</g, '><')
      expect(html).toBe(row.html.replace(/&nbsp;/g, '\u00a0'))
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
