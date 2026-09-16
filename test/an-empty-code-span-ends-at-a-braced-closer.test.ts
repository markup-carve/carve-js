import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// An empty code span is written as an unclosed run, so only a braced closer can
// end an emphasis around it (carve-js#1773, markup-carve/carve#2051).
describe('an emphasis ending in an empty code span', () => {
  it.each([
    ['{~` ~}\n', '{~``~}\n'],
    ['a {~` ~} b\n', 'a {~``~} b\n'],
    ['{*`  *}\n', '{*``*}\n'],
    ['{~`~}\n', '{~``~}\n'],
    ['{/` /}\n', '{/``/}\n'],
    ['{_` _}\n', '{_``_}\n'],
    ['{=` =}\n', '{=``=}\n'],
  ])('writes %j with the braced closer', (src, want) => {
    const out = carveToCarve(src)
    expect(out).toBe(want)
    expect(carveToHtml(out)).toBe(carveToHtml(src))
    expect(carveToCarve(out)).toBe(out)
  })

  it('keeps the bare closer when the code span has content', () => {
    expect(carveToCarve('{~`a ~}\n')).toBe('~`a`~\n')
  })

  it('leaves an emphasis that holds no code span bare', () => {
    expect(carveToCarve('{~a~}\n')).toBe('~a~\n')
    expect(carveToCarve('{*a*}\n')).toBe('*a*\n')
  })
})
