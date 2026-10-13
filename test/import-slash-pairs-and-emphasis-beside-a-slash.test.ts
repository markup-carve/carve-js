import { describe, expect, it } from 'vitest'
import { bbcodeToCarve, carveToHtml, djotToCarve, markdownToCarve } from '../src/index.js'

const html = (carve: string) => carveToHtml(carve).trim()
const importers = { markdown: markdownToCarve, djot: djotToCarve, bbcode: bbcodeToCarve }

describe('an imported slash pair that holds slashes stays literal', () => {
  // None of the three source languages has slash emphasis.
  for (const [name, convert] of Object.entries(importers)) {
    it.each([
      ['/usr/local/', '\\/usr/local/'],
      ['see /a/b/ here', 'see \\/a/b/ here'],
      ['(/a/b/)', '(\\/a/b/)'],
    ])(`${name} writes %j as %j`, (source, carve) => {
      expect(convert(source + '\n')).toBe(carve + '\n')
      expect(html(carve)).toBe(`<p>${source}</p>`)
    })

    it.each([
      ['/a b/', '\\/a b/'],
      ['/a b/c d/', '\\/a b/c d/'],
      ['/a /b/', '\\/a \\/b/'],
      ['/aa //', '\\/aa //'],
    ])(`${name} writes %j as %j`, (source, carve) => {
      expect(convert(source + '\n')).toBe(carve + '\n')
      expect(html(carve)).toBe(`<p>${source}</p>`)
    })

    it.each(['/usr/local/bin', 'a/b/c', 'x /a/b c', 'and/or'])(`${name} leaves %j bare`, (source) => {
      expect(convert(source + '\n')).toBe(source + '\n')
      expect(html(source)).toBe(`<p>${source}</p>`)
    })
  }

  it('renders no emphasis for any short Markdown line made of slashes, letters, spaces and dots', () => {
    const alphabet = ['/', 'a', ' ', '.', '(']
    const emphasized: string[] = []
    const visit = (line: string): void => {
      if (line.includes('/') && !/^\s|\s$/.test(line) && html(markdownToCarve(line + '\n')).includes('<em>')) emphasized.push(line)
      if (line.length < 5) for (const char of alphabet) visit(line + char)
    }
    visit('')
    expect(emphasized).toEqual([])
  })
})

describe('Markdown emphasis beside a literal slash keeps its emphasis', () => {
  it.each([
    ['a/*x*/b', 'a\\/{/x/}\\/b', '<p>a/<em>x</em>/b</p>'],
    ['/*x* a', '\\/{/x/} a', '<p>/<em>x</em> a</p>'],
    ['a /*x*/ b', 'a \\/{/x/}\\/ b', '<p>a /<em>x</em>/ b</p>'],
    ['a/_x_/b', 'a\\/{/x/}\\/b', '<p>a/<em>x</em>/b</p>'],
    ['*x*/ a', '/x/\\/ a', '<p><em>x</em>/ a</p>'],
    ['a/**x**/b', 'a\\/*x*\\/b', '<p>a/<strong>x</strong>/b</p>'],
  ])('imports %j as %j', (markdown, carve, rendered) => {
    expect(markdownToCarve(markdown + '\n')).toBe(carve + '\n')
    expect(html(carve)).toBe(rendered)
  })
})
