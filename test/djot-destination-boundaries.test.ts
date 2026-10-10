import { describe, expect, it } from 'vitest'
import { parse as parseDjot, renderHTML as renderDjotHtml } from '@djot/djot'
import { maskDjotCodeAndDestinations } from '../src/djot-migrate.js'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-destination-boundaries.json'

describe('Djot destination boundaries', () => {
  for (const row of fixtures) {
    it(row.name, () => {
      const html = carveToHtml(djotToCarve(row.source)).trim()
        .replace(/(?:href|src)="([^"]*)"/g, (all, url: string) => all.replace(url, url.replace(/[()`]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase())))
        .replaceAll(' aria-label="Footnotes"', '').replaceAll(' aria-label="Back to reference"', '').replace(/↩︎/g, '↩').replace(/&nbsp;/g, '\u00a0').replace(/<\/?tbody>/g, '').replace(/>\s+</g, '><').replace(/\n[ \t]+(<[ou]l>)/g, '\n$1')
      expect(html).toBe(row.html.replaceAll(' aria-label="Footnotes"', '').replaceAll(' aria-label="Back to reference"', '').replace(/↩︎/g, '↩').replace(/&nbsp;/g, '\u00a0').replace(/<img alt="([^"]*)" src="([^"]*)">/g, '<img src="$2" alt="$1">'))
    })
  }
})

it('preserves a link immediately after a footnote', () => {
  const html = carveToHtml(djotToCarve('note[^1][t](u~x~y)\n\n[^1]: note'))
  expect(html).toContain('<a href="u~x~y">t</a>')
  expect(html.replace(/>\s+</g, '><')).toContain('<li id="fn1"><p>note')
})

it('preserves existing percent escapes exactly', () => {
  const source = '[t](u%28x%29y)'
  expect(djotToCarve(source)).toBe(source)
  expect(carveToHtml(djotToCarve(source))).toContain('href="u%28x%29y"')
})

it('keeps code and attribute parentheses inside the destination', () => {
  for (const target of ['u`)`z', 'u{a=")"}x']) {
    const source = `[t](${target}) and ~x~ later`
    expect(maskDjotCodeAndDestinations(source)).toBe('[t]' + ' '.repeat(target.length + 2) + ' and ~x~ later')
  }
})

it('keeps destinations visible when inline forms are disabled', () => {
  const source = '[t](u~x~)'
  expect(maskDjotCodeAndDestinations(source, false, true, false)).toBe(source)
})

it('checks the shared fixtures against the Djot parser', () => {
  for (const row of fixtures) {
    // Published Djot 0.3.2 has older image and rejected-attribute behavior; these use its current repository.
    if (row.source.includes('![') || row.source === '[a](b]{not valid})') continue
    const html = renderDjotHtml(parseDjot(row.source)).trim()
      .replace(/↩︎/g, '↩')
      .replace(/<\/?tbody>/g, '').replace(/>\s+</g, '><')
      .replace(/<li>\n/g, '<li>').replace(/\n<\/li>/g, '</li>')
      .replace(/(?:href|src)="([^"]*)"/g, (all, url: string) => all.replace(url, url
        .replace(/\](?=[\[{])/g, '%5D').replace(/&quot;/g, '%22').replace(/&lt;/g, '%3C').replace(/&gt;/g, '%3E')
        .replace(/[()` |]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase())))
    expect(html, row.name).toBe(row.html)
  }
})

it('treats footnote suffix parentheses as text', () => {
  for (const prefix of ['', '!']) {
    const html = carveToHtml(djotToCarve(`${prefix}[^n](a ~b~ c)\n\n[^n]: note`))
    expect(html).toContain('(a <sub>b</sub> c)')
    expect(html).toContain('href="#fn1"')
    if (prefix) expect(html).toContain('<p>!<a id="fnref1"')
  }
})
