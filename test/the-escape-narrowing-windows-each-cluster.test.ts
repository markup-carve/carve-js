import { describe, expect, it, vi } from 'vitest'
import type { BlockNode, Document } from '../src/ast.js'

// Counts the source the parser reads, so the cost of the escape narrowing is
// measured in re-parsed bytes rather than in wall-clock time on a loaded runner.
const parsed = vi.hoisted(() => ({ bytes: 0 }))
vi.mock('../src/parse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/parse.js')>()
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      parsed.bytes += args[0].length
      return actual.parse(...args)
    },
  }
})

const { renderCarve } = await import('../src/index.js')

const text = (value: string) => ({ type: 'text' as const, value })

/** A paragraph whose `* ` opens a list unless it stays escaped. */
const needsEscape = (label: string): BlockNode => ({
  type: 'paragraph',
  attrs: { classes: ['n'], order: ['.class'] },
  children: [text(`* item ${label} and 1. two`)],
})

/** One failing paragraph every 40, and a footnote body that needs its escape too. */
const sparse = (paragraphs: number): Document => ({
  type: 'document',
  children: Array.from({ length: paragraphs }, (_, i): BlockNode => i % 40 === 0
    ? needsEscape(String(i))
    : { type: 'paragraph', children: [text(`plain *text* here ${i}`), { type: 'footnote_ref', label: 'n' }, text('.')] }),
  footnoteDefs: { n: [needsEscape('n'), { type: 'paragraph', children: [text('plain *text* note.')] }] },
})

describe('the escape narrowing search on far apart units', () => {
  it('probes each cluster and the footnote body in their own windows', () => {
    parsed.bytes = 0
    const carve = renderCarve(sparse(800))
    // One window from the first failing unit to the last, and a whole-document
    // probe for every group holding the footnote unit, cost about 24 here.
    expect(parsed.bytes / carve.length).toBeLessThan(18)
    // Cheaper probes let the search reach the late paragraphs before its parse
    // allowance runs out, so they keep only the escape they need.
    expect(carve).toContain('{.n}\n\\* item 760 and 1. two\n\nplain \\*text* here 761[^n].\n')
    expect(carve.endsWith('plain \\*text* here 799[^n].\n\n[^n]: {.n}\n  \\* item n and 1. two\n\n  plain \\*text* note.\n')).toBe(true)
  })
})
