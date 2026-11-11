import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'
import type { BlockNode } from '../src/ast.js'

const commentsIn = (blocks: BlockNode[]): unknown[] => blocks.flatMap((block): unknown[] => {
  if (block.type === 'comment') return [{ form: block.delimited ? 'braced' : 'line', content: block.content }]
  if (block.type === 'block_quote') return commentsIn(block.children)
  if (block.type === 'list') return block.items.flatMap(item => commentsIn(item.children))
  return []
})
const fmt = (source: string): string => renderCarve(parse(source, { positions: true }))

// A paragraph of only braced comments renders nothing, but its comments stay
// in the tree and the writer emits them back (PART 0 L1, PART 9 §21a, carve#5929).
describe('a comment-only paragraph keeps its comment nodes', () => {
  it.each([
    ['- > {% a\n  >  b\n  >  z %}\n', '- > {% a\n  >  b\n  >  z %}\n'],
    ['> {% a\n>  b\n>  z %}\n', '> {% a\n>  b\n>  z %}\n'],
    ['{% a\n b\n z %}\n', '{% a\n b\n z %}\n'],
    ['p\n\n> {% a %}\n', 'p\n\n> {% a %}\n'],
  ])('writes %j back', (source, expected) => {
    expect(fmt(source)).toBe(expected)
  })

  it('keeps a multi-line run on a quoted marker line (corpus 1046)', () => {
    const doc = parse('- > {% a\n  >  b\n  >  z %}\n')
    expect(commentsIn(doc.children)).toEqual([{ form: 'braced', content: 'a\nb\nz' }])
  })

  it('keeps every comment of the paragraph', () => {
    expect(commentsIn(parse('{% a %} {% b %}\n').children)).toEqual([
      { form: 'braced', content: 'a' },
      { form: 'braced', content: 'b' },
    ])
  })

  it('keeps a note body run (corpus 1055)', () => {
    const source = 'x[^n]\n\n[^n]: {% a\n     b\n     z %}\n    {.x}\nplain\n'
    expect(fmt(source)).toBe('x[^n]\n\nplain\n\n[^n]: {% a\n   b\n   z %}\n')
  })

  it('still renders nothing', () => {
    expect(carveToHtml('> {% a\n>  b\n>  z %}\n')).toBe('<blockquote>\n\n</blockquote>')
  })
})
