import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const html = (src: string) => renderHtml(parse(src)).trim()

describe('a glued attribute run is one physical line (carve#4078)', () => {
  it('merges a glued run on one line', () => {
    expect(html('{.a}{.b}\np\n')).toBe('<p class="a b">p</p>')
  })

  it.each([
    ['a break inside a later block', '{.a}{.b\n}\np\n', '<p>{.a}{.b\n}\np</p>'],
    ['a block glued after a wrapped block', '{.a\n}{.b}\np\n', '<p>{.a\n}{.b}\np</p>'],
    ['a wrapped run with nothing below', '{k=""}{c\n}\n', '<p>{k=““}{c\n}</p>'],
  ])('leaves %s as paragraph text', (_name, src, out) => {
    expect(html(src)).toBe(out)
  })

  it('still lets a lone block wrap, and keeps stacked lines apart', () => {
    expect(html('{.a\n}\np\n')).toBe('<p class="a">p</p>')
    expect(html('{.a\n}\n{.b}\np\n')).toBe('<p class="a b">p</p>')
    expect(html('> {.a\n> }{.b}\n> p\n')).not.toContain('class=')
  })
})
