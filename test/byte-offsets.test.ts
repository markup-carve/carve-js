import { describe, it, expect } from 'vitest'
import { parse, lintCarve } from '../src/index.js'

/**
 * PART 12 §4: "offsets are 0-based byte offsets into the source".
 *
 * The scanner counts UTF-16 code units, because that is how JavaScript indexes
 * strings, and the two agree for ASCII - which is why no fixture ever caught the
 * difference. They diverge on the first non-ASCII character, so an AST handed to
 * carve-rs or carve-php (whose strings are byte-indexed) described a different
 * span than the author wrote.
 *
 * These assert by slicing the source as BYTES, so a UTF-16 offset fails.
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

describe('AST offsets are byte offsets', () => {
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
    it(`slices back as bytes: ${label}`, () => {
      const buf = Buffer.from(src, 'utf8')
      const nodes = textNodes(parse(src))
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        const slice = buf.subarray(node.pos.startOffset, node.pos.endOffset).toString('utf8')
        expect(slice).toBe(node.value)
      }
    })
  }

  it('differs from the UTF-16 offset once the source is not ASCII', () => {
    // Guards the fast path: if this ever equalled the UTF-16 index again, the
    // conversion would have silently stopped happening.
    const src = '😀 *bold*\n'
    const strong = (parse(src).children[0] as { children: Array<Record<string, any>> }).children.find(
      (c) => c.type === 'strong',
    )!
    expect(strong.pos.startOffset).toBe(Buffer.byteLength('😀 ', 'utf8'))
    expect(strong.pos.startOffset).not.toBe('😀 '.length)
  })

  it('leaves an ASCII-only document unchanged', () => {
    const src = 'a *b* c\n'
    const strong = (parse(src).children[0] as { children: Array<Record<string, any>> }).children.find(
      (c) => c.type === 'strong',
    )!
    expect(strong.pos.startOffset).toBe(src.indexOf('*'))
  })

  it('lintCarve still reports UTF-16 offsets a JS caller can slice with', () => {
    // The AST is byte-based for cross-engine exchange; a diagnostic is consumed
    // by JavaScript (carve-lsp, editors), so handing it bytes would highlight
    // the wrong text on any non-ASCII document.
    const src = '# T\n\né é [^nope] here\n'
    const [warning] = lintCarve(src)
    expect(src.slice(warning!.start, warning!.end)).toBe('[^nope]')
  })
})
