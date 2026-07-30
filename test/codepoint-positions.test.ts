import { describe, it, expect } from 'vitest'
import { parse, lintCarve } from '../src/index.js'

/**
 * PART 12 §4 pins positions in CODEPOINTS.
 *
 * The scanner counts UTF-16 code units, because that is how JavaScript indexes
 * strings. The two agree across the whole Basic Multilingual Plane, so `é` and
 * `한` were already right and only astral characters differ - a fixture has to
 * contain a surrogate pair to tell them apart, which is why nothing caught it.
 *
 * These assert by slicing the source as an array of CODEPOINTS, so a UTF-16
 * offset fails on astral input.
 */
const textNodes = (node: unknown): Array<Record<string, any>> => {
  const out: Array<Record<string, any>> = []
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'text') out.push(n)
    for (const key of ['children', 'items', 'cells', 'rows']) {
      if (Array.isArray(n[key])) n[key].forEach(walk)
    }
  }
  walk(node)
  return out
}

describe('AST positions are codepoint positions', () => {
  const cases: Record<string, string> = {
    ascii: 'plain text here\n',
    'two-byte (é)': 'éé and *bold* here\n',
    'three-byte (한)': '한글 and *bold*\n',
    'astral (emoji)': '😀 emoji *bold* x\n',
    'non-ascii in a blockquote': '# H\n\n> éé quoted *b*\n',
    'non-ascii in a list': '- é item\n- 😀 second\n',
    'non-ascii across lines': '# H\n\n> é one\n> 😀 two\n',
  }

  for (const [label, src] of Object.entries(cases)) {
    it(`slices back as codepoints: ${label}`, () => {
      const codepoints = [...src]
      const nodes = textNodes(parse(src))
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        const slice = codepoints.slice(node.pos.startOffset, node.pos.endOffset).join('')
        expect(slice).toBe(node.value)
      }
    })
  }

  it('differs from the UTF-16 offset once the source has an astral character', () => {
    // Guards the fast path: if this ever equalled the UTF-16 index again, the
    // conversion would have silently stopped happening.
    const src = '😀 *bold*\n'
    const strong = (parse(src).children[0] as { children: Array<Record<string, any>> }).children.find(
      (c) => c.type === 'strong',
    )!
    expect(strong.pos.startOffset).toBe([...'😀 '].length)
    expect(strong.pos.startOffset).not.toBe('😀 '.length)
  })

  it('agrees with UTF-16 for the whole Basic Multilingual Plane', () => {
    // `é` and `한` are one UTF-16 unit each, so no conversion is needed and the
    // fast path is correct to skip them.
    for (const src of ['éé *b*\n', '한글 *b*\n']) {
      const strong = (parse(src).children[0] as { children: Array<Record<string, any>> }).children.find(
        (c) => c.type === 'strong',
      )!
      expect(strong.pos.startOffset).toBe(src.indexOf('*'))
    }
  })

  it('reports columns in codepoints too, consistent with the offset', () => {
    const src = '😀😀 *b*\n'
    const strong = (parse(src).children[0] as { children: Array<Record<string, any>> }).children.find(
      (c) => c.type === 'strong',
    )!
    // Two emoji plus a space: column 4 in codepoints, 6 in UTF-16.
    expect(strong.pos.startColumn).toBe(4)
  })

  it('leaves an ASCII-only document unchanged', () => {
    const src = 'a *b* c\n'
    const strong = (parse(src).children[0] as { children: Array<Record<string, any>> }).children.find(
      (c) => c.type === 'strong',
    )!
    expect(strong.pos.startOffset).toBe(src.indexOf('*'))
  })

  it('lintCarve still reports UTF-16 offsets a JS caller can slice with', () => {
    // The AST is codepoint-based for cross-engine exchange; a diagnostic is
    // consumed by JavaScript (carve-lsp, editors), so handing it codepoints
    // would highlight the wrong text on any astral document.
    const src = '# T\n\n😀 😀 [^nope] here\n'
    const [warning] = lintCarve(src)
    expect(src.slice(warning!.start, warning!.end)).toBe('[^nope]')
  })
})
