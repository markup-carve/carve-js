import { describe, it, expect } from 'vitest'
import { slugify } from '../src/heading-ids.js'
import { parse, carveToHtml, renderHtml, type Document } from '../src/index.js'
import { MAX_NESTING_DEPTH } from '../src/parse.js'

/**
 * Trojan-Source (CVE-2021-42574) and nesting-cap hardening.
 *
 *  - Change 1: heading-id slugs are NFC-normalized and have bidi-override /
 *    isolate controls and zero-width characters stripped, so an id is
 *    deterministic and never carries an invisible / reordering code point.
 *  - Change 2: bidi-override / isolate controls in rendered TEXT and CODE are
 *    escaped to numeric character references (rendered inert + visible in
 *    source). The directional MARKS (LRM/RLM) and zero-width chars are NOT
 *    escaped in text.
 *  - Change 3: a single MAX_NESTING_DEPTH cap (200) applies uniformly to
 *    blockquote / list / div-admonition nesting.
 */

const BIDI = {
  LRE: '‪',
  RLE: '‫',
  PDF: '‬',
  LRO: '‭',
  RLO: '‮',
  LRI: '⁦',
  RLI: '⁧',
  FSI: '⁨',
  PDI: '⁩',
}
const ZW = {
  ZWSP: '​',
  ZWNJ: '‌',
  ZWJ: '‍',
  WJ: '⁠',
  BOM: '﻿',
  SHY: '­',
}
// Directional marks: legitimate RTL layout, NOT escaped.
const LRM = '‎'
const RLM = '‏'

describe('Change 1: heading-id Trojan-Source hardening', () => {
  it('NFC-normalizes so decomposed and precomposed text share one id', () => {
    const nfc = slugify('Café'.normalize('NFC'))
    const nfd = slugify('Café'.normalize('NFD'))
    expect(nfc).toBe('Café')
    expect(nfd).toBe(nfc)
  })

  it('strips bidi-override / isolate controls from the id', () => {
    for (const c of Object.values(BIDI)) {
      const id = slugify(`Hel${c}lo`)
      expect(id).toBe('Hello')
      expect(id).not.toContain(c)
    }
  })

  it('strips zero-width characters from the id', () => {
    for (const c of Object.values(ZW)) {
      const id = slugify(`Hel${c}lo`)
      expect(id).toBe('Hello')
      expect(id).not.toContain(c)
    }
  })

  it('a heading with U+202E and U+200B yields an id with neither', () => {
    const doc = carveToHtml(`# Hel${BIDI.RLO}lo${ZW.ZWSP}World`)
    const m = /id="([^"]*)"/.exec(doc)
    expect(m).not.toBeNull()
    const id = m![1]!
    expect(id).not.toContain(BIDI.RLO)
    expect(id).not.toContain(ZW.ZWSP)
    expect(id).toBe('HelloWorld')
  })
})

describe('Change 2: strip bidi controls from rendered text and code', () => {
  it('strips U+202E from inline text (DOM-inert)', () => {
    expect(carveToHtml(`a${BIDI.RLO}b`)).toBe('<p>ab</p>')
  })

  it('strips U+202E from a code span (inert)', () => {
    expect(carveToHtml(`\`a${BIDI.RLO}b\``)).toBe('<p><code>ab</code></p>')
  })

  it('strips a bidi override inside a fenced code listing (inert)', () => {
    const out = carveToHtml(`\`\`\`\nif (access)${BIDI.RLO} // ok\n\`\`\``)
    expect(out).not.toContain(BIDI.RLO)
    // Stripped, not entity-encoded: an HTML parser would decode &#x202e; back to
    // the raw control, so the only DOM-inert representation is removal.
    expect(out).not.toContain('&#x202')
  })

  it('strips every bidi-override / isolate control', () => {
    for (const ch of Object.values(BIDI)) {
      expect(carveToHtml(`x${ch}y`)).toBe('<p>xy</p>')
    }
  })

  it('does NOT strip the directional marks LRM / RLM (legitimate RTL)', () => {
    expect(carveToHtml(`a${LRM}b`)).toBe(`<p>a${LRM}b</p>`)
    expect(carveToHtml(`a${RLM}b`)).toBe(`<p>a${RLM}b</p>`)
  })

  it('does NOT strip zero-width characters in text', () => {
    expect(carveToHtml(`a${ZW.ZWSP}b`)).toBe(`<p>a${ZW.ZWSP}b</p>`)
    expect(carveToHtml(`a${ZW.ZWJ}b`)).toBe(`<p>a${ZW.ZWJ}b</p>`)
  })
})

describe('Change 3: uniform MAX_NESTING_DEPTH = 200', () => {
  it('exports the shared cap as 200', () => {
    expect(MAX_NESTING_DEPTH).toBe(200)
  })

  const maxDepth = (node: unknown, type: string, d = 0): number => {
    if (Array.isArray(node)) {
      let best = 0
      for (const n of node) best = Math.max(best, maxDepth(n, type, d))
      return best
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      const here = obj.type === type ? d + 1 : d
      let best = here
      const childD = obj.type === type ? d + 1 : d
      for (const k of ['children', 'items', 'definitions', 'target']) {
        if (obj[k]) best = Math.max(best, maxDepth(obj[k], type, childD))
      }
      return best
    }
    return 0
  }

  it('caps a 250-deep indented list at 200 without unbounded growth or crash', () => {
    let src = ''
    for (let i = 0; i < 250; i++) src += '  '.repeat(i) + '- x\n'
    let doc: Document
    expect(() => {
      doc = parse(src)
    }).not.toThrow()
    expect(maxDepth(doc!.children, 'list')).toBe(MAX_NESTING_DEPTH)
  })

  it('caps a 250-deep div at 200 without unbounded growth or crash', () => {
    // Varied-length `:::` fences so each opener nests inside the previous one
    // (a bare `:::` would otherwise close the nearest open div).
    const N = 250
    let src = ''
    for (let i = 0; i < N; i++) src += ':'.repeat(N + 3 - i) + '\n'
    src += 'x\n'
    for (let i = 0; i < N; i++) src += ':'.repeat(4 + i) + '\n'
    let doc: Document
    expect(() => {
      doc = parse(src)
    }).not.toThrow()
    expect(maxDepth(doc!.children, 'div')).toBe(MAX_NESTING_DEPTH)
  })

  it('caps a 250-deep blockquote at 200 (same shared gate)', () => {
    const src = '> '.repeat(250) + 'x'
    const doc = parse(src)
    expect(maxDepth(doc.children, 'blockquote')).toBe(MAX_NESTING_DEPTH)
  })
})

describe('Change 4: scheme probe is Unicode-whitespace aware', () => {
  const linkDoc = (href: string): Document => ({
    type: 'document',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'link', href, children: [{ type: 'text', value: 'x' }] }],
      },
    ],
  })

  it('strips a NARROW NO-BREAK SPACE (U+202F) before the scheme', () => {
    expect(renderHtml(linkDoc(' javascript:alert(1)'))).toBe('<p><a href="">x</a></p>')
  })

  it('strips other Unicode space separators before the scheme', () => {
    for (const sp of [' ', ' ', ' ', '　', ' ', ' ', '﻿']) {
      expect(renderHtml(linkDoc(`${sp}javascript:alert(1)`))).toBe('<p><a href="">x</a></p>')
    }
  })

  it('blocks a leading-ASCII-space javascript: scheme', () => {
    const out = renderHtml(linkDoc('  javascript:alert(1)'))
    expect(out).not.toMatch(/href="[^"]*javascript:/)
    expect(out).toBe('<p><a href="">x</a></p>')
  })

  it('still passes a clean https href unchanged', () => {
    expect(renderHtml(linkDoc('https://example.com'))).toBe(
      '<p><a href="https://example.com">x</a></p>',
    )
  })
})
