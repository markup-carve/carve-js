import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, migrateMarkdown } from '../src/index.js'

const back = (source: string) => migrateMarkdown(carveToMarkdown(source, { roundtrip: true })).value

describe('roundtrip Markdown: native reference links (CARVE-P11-028)', () => {
  it('keeps the inline form outside roundtrip', () => {
    expect(carveToMarkdown('[a][r]\n\n[r]: /u\n')).toBe('[a](/u)\n')
  })

  it('writes the title on the definition line only', () => {
    expect(carveToMarkdown('[a][r]\n\n[r]: /u "T"\n', { roundtrip: true })).toBe('[a][r]\n\n[r]: /u "T"\n')
  })

  it('stays inline when Markdown would case-fold two labels together', () => {
    const source = '[a][r] [b][R]\n\n[r]: /u\n\n[R]: /v\n'
    const markdown = carveToMarkdown(source, { roundtrip: true })
    expect(markdown).toContain('[a](/u) [b](/v)')
    expect(carveToHtml(migrateMarkdown(markdown).value)).toBe(carveToHtml(source))
  })

  it('writes a collapsed reference in full when the text is not the label', () => {
    expect(carveToMarkdown('[*r*][]\n\n[*r*]: /u\n', { roundtrip: true })).toContain('[**r**][*r*]')
  })
})

describe('roundtrip Markdown: marker bytes (CARVE-P11-063)', () => {
  it('pairs a bare div inside a named one', () => {
    const source = '::: note\n::::\nx\n::::\n:::\n'
    expect(carveToMarkdown(source, { roundtrip: true })).toContain('<!-- carve: :::: -->\nx')
    expect(back(source)).toBe(source)
    expect(back(':::\ninside\n:::\n')).toBe(':::\ninside\n:::\n')
    expect(migrateMarkdown('<!-- carve: :::  -->\ninside\n\n<!-- carve: ::: -->\n').value).toBe(':::\ninside\n:::\n')
  })

  it('reads a payload spanning lines behind a block quote', () => {
    const source = '> :: A term that\n> wraps here\n> : its definition\n'
    expect(back(source)).toBe(source)
  })
})

describe('Markdown import: abbreviations (CARVE-P11-033 T1)', () => {
  it('folds an abbr a definition resolves back to the plain term', () => {
    expect(back('*[HTML]: Hyper Text\n\nHTML here\n')).toBe('*[HTML]: Hyper Text\n\nHTML here\n')
  })

  it('keeps an abbr whose title no definition gives its text', () => {
    expect(migrateMarkdown('*[HTML]: Hyper Text\n\n<abbr title="Other">HTML</abbr>\n').value)
      .toBe('*[HTML]: Hyper Text\n\n[HTML]{abbr=Other}\n')
  })

  it('keeps an abbr when the document defines nothing', () => {
    expect(migrateMarkdown('<abbr title="Hyper Text">HTML</abbr>\n').value).toBe('[HTML]{abbr="Hyper Text"}\n')
  })
})
