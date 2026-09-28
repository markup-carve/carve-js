import { describe, it, expect } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'

function count(source: string): number {
  const exec = RegExp.prototype.exec
  let calls = 0
  RegExp.prototype.exec = function(value: string): RegExpExecArray | null {
    calls++
    return Reflect.apply(exec, this, [value])
  }
  try { parse(source) } finally { RegExp.prototype.exec = exec }
  return calls
}
describe('container prefix classification', () => {
  for (const marker of ['> ', '- ', '1. ']) for (const follower of ['', 'tail\n']) it(`${marker} with ${JSON.stringify(follower)} grows with depth`, () => {
    const source = (depth: number): string => marker.repeat(depth) + 'end\n' + follower
    const small = count(source(64)), large = count(source(128))
    expect(small).toBeGreaterThan(64)
    expect(large / small).toBeLessThan(2.25)
    expect(count(source(128))).toBe(large)
  })
  it('retains a following lazy paragraph and closed-block boundaries', () => {
    expect(carveToHtml('- - a\ntail\n')).toContain('a\ntail')
    expect(carveToHtml('- - # H\ntail\n')).toMatch(/<\/ul>\s*<p>tail<\/p>/)
  })
  it('keeps fenced blank lines from loosening a list', () => {
    const html = carveToHtml('- ```\n  a\n\n  b\n  ```\n- c\n')
    expect(html).toContain('a\n\nb\n')
    expect(html).toContain('<li>c</li>')
  })
})
