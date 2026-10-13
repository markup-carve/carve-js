import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalized = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('a line-final run is dropped before the line is read', () => {
  it('separates items inside nested quotes', () => {
    expect(normalized(carveToHtml('> > - a\n> >\t\n> > - b\n'))).toBe(
      '<blockquote><blockquote><ul><li><p>a</p></li><li><p>b</p></li></ul></blockquote></blockquote>',
    )
  })

  it('keeps a tab-only quote remainder as an empty fence payload line', () => {
    expect(normalized(carveToHtml('> ```\n> x\n>\t\n> y\n> ```\n'))).toBe(
      '<blockquote><pre><code>x\n\ny\n</code></pre></blockquote>',
    )
  })

  it('separates paragraphs inside one quote', () => {
    expect(normalized(carveToHtml('> a\n>\t\n> b\n'))).toBe(
      '<blockquote><p>a</p><p>b</p></blockquote>',
    )
  })

  it('reads a list marker with a trailing run like the bare marker', () => {
    for (const run of ['  ', ' \t', '\t ']) {
      expect(carveToHtml(`-${run}\n- b\n`)).toBe(carveToHtml('-\n- b\n'))
      expect(carveToHtml(`1.${run}\n2. b\n`)).toBe(carveToHtml('1.\n2. b\n'))
      expect(carveToHtml(`- [ ]${run}\n- b\n`)).toBe(carveToHtml('- [ ]\n- b\n'))
    }
  })

  it('reads a whitespace-only footnote remainder like the bare marker', () => {
    const expected = '<p>[^n]:\nbody</p>'
    expect(carveToHtml('[^n]:\n    body\n')).toBe(expected)
    expect(carveToHtml('[^n]: \t\n    body\n')).toBe(expected)
  })

  it('keeps a tab after a consumed quote separator as verbatim payload', () => {
    expect(normalized(carveToHtml('> ```\n> x\n> \t\n> y\n> ```\n'))).toBe(
      '<blockquote><pre><code>x\n\t\ny\n</code></pre></blockquote>',
    )
  })

  it('keeps a tab before content from becoming a quote separator', () => {
    for (const run of ['\t', '\t'.repeat(64)]) {
      expect(carveToHtml(`>${run}foo\n`)).toBe(`<p>&gt;${run}foo</p>`)
    }
  })
})
