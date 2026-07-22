import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'
import { renderHtml } from '../src/render-html.js'
import { parse, resolve } from '../src/index.js'
import type { CarveExtension } from '../src/extension.js'
import {
  ABBR_BUDGET_BASE,
  ABBR_BUDGET_FACTOR,
  abbrBudget,
  utf8ByteLength,
} from '../src/abbr-budget.js'

describe('abbreviation-expansion amplification (DoS guard)', () => {
  // A tiny input that defines a huge expansion (`*[HT]: <50KB>`) and uses the
  // key many times amplifies output by expansion_len x occurrences. Before the
  // guard this reached ~512MB and threw `RangeError: Invalid string length`
  // (V8 max string length) - a crash-DoS of the request. The renderers now bound
  // cumulative expansion bytes to max(BASE, FACTOR * sourceByteLength) and
  // degrade later occurrences to the plain key text.
  // 50KB expansion x 1000 uses = ~50MB naive output, ~50x over the 1MB base
  // budget - enough to prove the guard degrades and never throws, while keeping
  // the test light enough not to pressure other parallel perf tests' timings.
  const EXPANSION_LEN = 50_000
  const OCCURRENCES = 1000
  const expansion = 'X'.repeat(EXPANSION_LEN)
  const src = `*[HT]: ${expansion}\n\n` + 'HT '.repeat(OCCURRENCES)
  const srcBytes = utf8ByteLength(src)
  const budget = abbrBudget(srcBytes)

  it('exposes a budget far above the input but well below the naive blowup', () => {
    // base 1_000_000, factor 8 (must match carve-rs / carve-php).
    expect(ABBR_BUDGET_BASE).toBe(1_000_000)
    expect(ABBR_BUDGET_FACTOR).toBe(8)
    expect(budget).toBe(Math.max(1_000_000, 8 * srcBytes))
    // The naive (unbounded) output would be ~expansion x occurrences bytes.
    const naive = EXPANSION_LEN * OCCURRENCES
    expect(budget).toBeLessThan(naive / 10)
  })

  for (const [name, api] of [
    ['HTML', carveToHtml],
    ['Markdown', carveToMarkdown],
    ['ANSI', carveToAnsi],
  ] as const) {
    it(`${name}: renders without throwing, bounded near the budget, fast`, () => {
      const t0 = Date.now()
      let out: string | undefined
      expect(() => {
        out = api(src)
      }).not.toThrow()
      const ms = Date.now() - t0
      expect(typeof out).toBe('string')
      // Output stays near the budget (expansion bytes + per-occurrence wrapper
      // and key bytes), nowhere near the ~100MB naive blowup. A loose 3x-budget
      // ceiling proves the bound without being brittle.
      expect(out!.length).toBeLessThan(budget * 3)
      // Only as many full expansions as fit in the budget are emitted.
      const fullExpansions = out!.split(expansion).length - 1
      expect(fullExpansions).toBeLessThanOrEqual(Math.ceil(budget / EXPANSION_LEN))
      // Fast: a real document is far below budget; even this worst case is quick.
      expect(ms).toBeLessThan(2000)
    })
  }

  it('plain text drops the expansion entirely (no amplification possible)', () => {
    let out: string | undefined
    expect(() => {
      out = carveToPlainText(src)
    }).not.toThrow()
    expect(out!.includes(expansion)).toBe(false)
  })

  it('a normal small abbreviation still renders <abbr title=...> under budget', () => {
    const small = '*[HTML]: HyperText Markup Language\n\nUse HTML here.'
    expect(carveToHtml(small)).toContain(
      '<abbr title="HyperText Markup Language">HTML</abbr>',
    )
    expect(carveToMarkdown(small)).toContain(
      '<abbr title="HyperText Markup Language">HTML</abbr>',
    )
    // ANSI emits the dim ` (EXPANSION)` suffix when under budget.
    expect(carveToAnsi(small)).toContain('(HyperText Markup Language)')
  })

  it('counter resets per render call (no leak across calls)', () => {
    // Render the worst case twice; the second call must not inherit an
    // exhausted budget from the first. If it leaked, the second small render
    // would degrade and drop the <abbr>.
    carveToHtml(src)
    const small = '*[HTML]: HyperText Markup Language\n\nUse HTML here.'
    expect(carveToHtml(small)).toContain(
      '<abbr title="HyperText Markup Language">HTML</abbr>',
    )
  })

  it('HTML budget survives a nested renderHtml() from an extension (re-entrancy)', () => {
    // An extension block renderer that calls renderHtml() recursively must not
    // wipe the outer document's abbreviation budget. The outer render places
    // the extension block before the amplifying abbreviation uses; if the
    // module-scoped tracker were cleared to null on the nested return, the
    // outer uses would emit unbounded expansions. With save/restore they stay
    // bounded and degrade to plain key text.
    let nestedCalled = false
    const nesting: CarveExtension = {
      name: 'nest',
      matchBlock(lines, start) {
        if (lines[start] !== '@@@nest') return null
        return {
          node: { type: 'inline_extension', name: 'nest', content: [] },
          linesConsumed: 1,
        }
      },
      blockRenderers: {
        // Render a whole sub-document via renderHtml() while the outer render
        // is mid-flight - the scenario that previously nulled the tracker.
        // Keyed by node type ('inline_extension'), per the render-html dispatch.
        inline_extension: () => {
          nestedCalled = true
          return renderHtml(resolve(parse('Inner doc.')))
        },
      },
    }
    const doc = `*[HT]: ${expansion}\n\n@@@nest\n\n` + 'HT '.repeat(OCCURRENCES)
    const docBudget = abbrBudget(utf8ByteLength(doc))
    const ast = resolve(parse(doc, { extensions: [nesting] }))
    let out: string | undefined
    expect(() => {
      out = renderHtml(ast, { extensions: [nesting] })
    }).not.toThrow()
    // The nested renderHtml() must actually have fired - otherwise this test
    // would not exercise the re-entrancy path at all.
    expect(nestedCalled).toBe(true)
    // Still bounded near the budget despite the nested render in the middle.
    const fullExpansions = out!.split(expansion).length - 1
    expect(fullExpansions).toBeLessThanOrEqual(Math.ceil(docBudget / EXPANSION_LEN))
    expect(out!.length).toBeLessThan(docBudget * 3)
  })
})
