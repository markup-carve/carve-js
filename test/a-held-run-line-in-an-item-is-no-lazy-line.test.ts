import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A valid run's continuation carries the item's prefix past its `{`, so the item collector
// must not frame it as lazy text (CARVE-P2-035, carve#5830 rule B, markup-carve/carve-js#4897).
const html = (source: string) => carveToHtml(source).replace(/\s+</g, '<').replace(/>\s+/g, '>').trim()

describe('a held run line in an item is no lazy line', () => {
  it('consumes a pulled comment run in a description inside an item', () => {
    expect(html('- :: t\n  : +\n  {% b\n   b %}\n  z\n')).toBe('<ul><li><dl><dt>t</dt><dd>z</dd></dl></li></ul>')
  })

  it('applies a pulled attribute run in a description inside an item', () => {
    expect(html('- :: t\n  : +\n  {.x\n   .y}\n  z\n')).toBe('<ul><li><dl><dt>t</dt><dd><p class="x y">z</p></dd></dl></li></ul>')
  })

  // The run reads as it does without the enclosing item.
  const RUNS = [['{% b', 'b %}'], ['{% a', 'b', 'c %}'], ['{.x', '.y}'], ['{#i', '.y}']]
  for (const [prefix, rest] of [['- ', '  '], ['1. ', '   '], ['- a\n  - ', '    ']]) {
    for (const marker of [': +', ':  +']) {
      for (const run of RUNS) {
        for (const column of [1, 2, 4]) {
          for (const tail of [[], ['z'], ['', 'z']]) {
            const lines = [':: t', marker, run[0]!, ...run.slice(1).map((line) => ' '.repeat(column) + line), ...tail]
            const bare = lines.join('\n') + '\n'
            const source = lines.map((line, index) => (index === 0 ? prefix : line === '' ? '' : rest) + line).join('\n') + '\n'
            it(JSON.stringify(source), () => {
              const inner = html(bare)
              expect(html(source)).toContain(inner.slice(inner.indexOf('<dl>'), inner.lastIndexOf('</dl>') + 5))
            })
          }
        }
      }
    }
  }
})
