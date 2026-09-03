import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

/*
 * A LAZY-FRAMED LINE IS STILL PLACEABLE (markup-carve/carve-js#1624).
 *
 * When an unmarked marker folds into the quote below it (carve-js#1615 /
 * carve-js#1618) the collector prepends the LAZY frame - three characters no
 * document can spell - and strips the line's indentation with it. That makes
 * the sub-line neither a literal suffix of its document line nor a
 * synthetic-indent case, so `attachDocumentOffsets` declined the whole
 * sub-lexer.
 *
 * Declining costs every position under it. The folded paragraph and each of its
 * inlines came out with no `pos` at all, and PART 12 section 4's exemption for a
 * REASSEMBLED node does not reach them: `x` and `- m` are plain slices of the
 * source, so they are placeable and nobody placed them. The containers above
 * them ended at the line before the text they own.
 *
 * The frame occupies no source, so the fix is the anchor the synthetic-indent
 * case already uses: the real content IS a suffix of its document line, which is
 * all an anchor needs. `attachBlockPos` measures the same line unframed, so the
 * three characters are charged nowhere.
 *
 * The rendered HTML is unchanged on all three documents - carve-js is the only
 * engine that matches the corpus on the `448` family, and this is positions only.
 */

type Node = { type: string; value?: string; pos?: { startOffset: number; endOffset: number }; children?: Node[]; items?: Node[] }

const nodes = (src: string): Node[] => {
  const out: Node[] = []
  const walk = (n: Node): void => {
    if (!n || typeof n !== 'object') return
    if (n.type && n.type !== 'document') out.push(n)
    for (const k of ['children', 'items'] as const) n[k]?.forEach(walk)
  }
  walk(carveToAstJson(src, { positions: true }) as Node)
  return out
}

const DOCS: [string, string][] = [
  ['448, the reported document', '- a\n  > - x\n  - m\n'],
  ['448-2, the quote on the marker line', '- > - x\n  - m\n'],
  ['448-3, a plain line between', '- a\n  > - x\n  p\n  - m\n'],
]

describe('every node under a folded quote line carries a position', () => {
  it.each(DOCS)('%s', (_name, src) => {
    const unplaced = nodes(src).filter((n) => !n.pos)
    expect(unplaced.map((n) => `${n.type} ${JSON.stringify(n.value ?? '')}`)).toEqual([])
  })

  it.each(DOCS)('%s: every text span slices back to its own value', (_name, src) => {
    for (const n of nodes(src).filter((x) => x.type === 'text')) {
      expect(src.slice(n.pos!.startOffset, n.pos!.endOffset)).toBe(n.value)
    }
  })

  it('the containers reach the text they own', () => {
    const src = '- a\n  > - x\n  - m\n'
    // The folded `- m` ends at offset 17; every container holding it must too.
    // They stopped at 10, the end of line 2, before this.
    const quote = nodes(src).find((n) => n.type === 'block_quote')!
    expect(quote.pos).toMatchObject({ startOffset: 6, endOffset: 17 })
    const para = nodes(src).find((n) => n.type === 'paragraph' && n.pos!.startOffset === 10)!
    expect(para.pos).toMatchObject({ startOffset: 10, endOffset: 17 })
  })

  it('the folded marker text is the whole `- m`, marker included', () => {
    const src = '- a\n  > - x\n  - m\n'
    const texts = nodes(src).filter((n) => n.type === 'text')
    expect(texts.map((n) => n.value)).toEqual(['a', 'x', '- m'])
    expect(src.slice(texts[2]!.pos!.startOffset, texts[2]!.pos!.endOffset)).toBe('- m')
  })
})

describe('the rendered output does not move', () => {
  it.each([
    ['- a\n  > - x\n  - m\n', '<ul>\n  <li>a\n    <blockquote>\n      <ul>\n        <li>x\n- m</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>'],
    ['- > - x\n  - m\n', '<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>x\n- m</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>'],
    ['- a\n  > - x\n  p\n  - m\n', '<ul>\n  <li>a\n    <blockquote>\n      <ul>\n        <li>x\np\n- m</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>'],
  ])('%j', (src, html) => {
    expect(carveToHtml(src)).toBe(html)
  })
})
