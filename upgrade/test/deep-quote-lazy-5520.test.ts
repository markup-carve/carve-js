import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { upgrade } from '../src/index.ts'

const lazyTwice = (depth: number): string => '> '.repeat(depth) + 'a\nb\n' + '> '.repeat(depth) + 'c\nd\n'

function fastest(run: () => void): number {
  let best = Infinity
  for (let round = 0; round < 3; round++) {
    const start = performance.now()
    run()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

describe('carve-js#5520: lazy lines below deep quotes', () => {
  it('reads every level the same as before', () => {
    for (const depth of [1, 2, 3, 7, 40]) {
      const html = carveToHtml(lazyTwice(depth))
      expect(html.match(/<blockquote>/g)).toHaveLength(depth)
      expect(html).toContain('<p>a\nb\nc\nd</p>')
    }
    expect(carveToHtml('> > a\n> b\nc\n')).toBe('<blockquote>\n  <blockquote><p>a\nb\nc</p></blockquote>\n</blockquote>')
  })

  it('renders eight times the depth in about eight times the time, not sixty-four', () => {
    carveToHtml(lazyTwice(200))
    const small = fastest(() => carveToHtml(lazyTwice(200)))
    const large = fastest(() => carveToHtml(lazyTwice(1600)))
    expect(large / small).toBeLessThan(7)
  })

  it('keeps the upgrade of the deep lazy quote', () => {
    const result = upgrade(lazyTwice(60))
    expect(result.output).toBe(lazyTwice(60))
    expect(result.check).toBe('pass')
  })
})
