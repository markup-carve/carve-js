import { describe, expect, test } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('marker attributes do not move the content column', () => {
  test.each([
    ['a short class', '-{.x} a\n  # h\n'],
    ['a long class', '-{.averylongclass} a\n  # h\n'],
    ['a Unicode value', '-{title="😀"} a\n  # h\n'],
    ['a task item', '-{title="😀"} [x] a\n  # h\n'],
    ['an ordered item', '1.{title="😀"} a\n   # h\n'],
  ])('%s', (_name, source) => {
    expect(carveToHtml(source)).toContain('<h1 id="h">h</h1>')
    const formatted = carveToCarve(source)
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  test('the former full-prefix column is accepted as an authored block base', () => {
    const html = carveToHtml('-{.x1} a\n       # h\n')
    expect(html).toContain('<h1')
  })

  test('different attribute lengths share one continuation column', () => {
    const html = carveToHtml('-{.x} a\n  # one\n-{.averylongclass} b\n  # two\n')
    expect(html).toContain('<h1 id="one">one</h1>')
    expect(html).toContain('<h1 id="two">two</h1>')
  })
})
