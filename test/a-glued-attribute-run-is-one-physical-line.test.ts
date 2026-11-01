import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const html = (src: string) => renderHtml(parse(src)).trim()

describe('each glued attribute block may wrap (carve#4078 superseding ruling)', () => {
  it('merges a glued run on one line', () => {
    expect(html('{.a}{.b}\np\n')).toBe('<p class="a b">p</p>')
  })

  it.each([
    ['a break inside a later block', '{.a}{.b\n}\np\n', '<p class="a b">p</p>'],
    ['a block glued after a wrapped block', '{.a\n}{.b}\np\n', '<p class="a b">p</p>'],
    ['a wrapped run with nothing below', '{k=""}{c\n}\n', ''],
  ])('reads %s by each block boundary', (_name, src, out) => {
    expect(html(src)).toBe(out)
  })

  it('still lets a lone block wrap, and keeps stacked lines apart', () => {
    expect(html('{.a\n}\np\n')).toBe('<p class="a">p</p>')
    expect(html('{.a\n}\n{.b}\np\n')).toBe('<p class="a b">p</p>')
    expect(html('> {.a\n> }{.b}\n> p\n')).toBe('<blockquote><p class="a b">p</p></blockquote>')
  })
})
