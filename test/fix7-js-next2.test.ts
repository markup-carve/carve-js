import { describe, expect, it } from 'vitest'
import { importDocument as importCore } from '../public/import.ts'
import { importDocument as importFormats } from '../public/formats.ts'
import { format, lint, parse, treesEqual } from '../src/index.ts'

const notes = '<p>c<a role="doc-noteref" href="#fn1">x</a><a role="doc-noteref" href="#fn2">y</a></p>' +
  '<section role="doc-endnotes"><ol><li id="fn1"><p>Old</p></li></ol></section>' +
  '<section role="doc-endnotes"><ol><li id="fn2"><p>New</p></li></ol></section>'

describe('fix7 JS 0.2 clauses', () => {
  it('C2-W-088 keeps literal paired brackets bare inside links', () => {
    for (const source of ['[[1]](#x)', '[a [b] c](#x)', '[[[1]]{.c}](#x)']) {
      expect(format(source)).toBe(`${source}\n`)
      expect(treesEqual(parse(format(source)), parse(source))).toBe(true)
    }
    expect(format('[[\\[1\\]]{.c}](#x)')).toBe('[[[1]]{.c}](#x)\n')
    expect(format('[\\]\\[]()')).toBe('[\\]\\[]()\n')
  })

  it('C2-M-061 consumes consecutive footnote sections without an empty placement', () => {
    expect(importCore(notes, { from: 'html' }).source).toBe('c[^1][^2]\n\n[^1]: Old\n\n[^2]: New\n')
  })

  it('C2-M-101 accepts labels on both public HTML imports', () => {
    const html = '<aside class="admonition note" aria-label="Hinweis"><p>x</p></aside>'
    const options = { from: 'html' as const, labels: { admonitionNote: 'Hinweis' } }
    expect(importCore(html, options).source).toBe('::: note\nx\n:::\n')
    expect(importFormats(html, options).source).toBe('::: note\nx\n:::\n')
    expect(() => importCore(html, { ...options, labels: { admonitionNote: 1 } } as never)).toThrow()
  })

  it('C2-B-025 reports overindented attribute lines consumed by paragraphs', () => {
    for (const marker of ['- a', '* a', '1. a']) {
      const column = marker.startsWith('1') ? 3 : 2
      for (const attrs of ['{.c}', '{#id}', '{#id .c k=v}']) {
        const source = `${marker}\n\n${' '.repeat(column + 2)}${attrs}\n${' '.repeat(column)}b\n`
        const findings = lint(source).filter(finding => finding.code === 'list-item-block-overindented')
        expect(findings, source).toHaveLength(1)
        expect(findings[0]?.range?.startOffset, source).toBe(source.indexOf(attrs))
      }
    }
  })
})
