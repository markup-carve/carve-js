import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const html = (src: string) => renderHtml(parse(src)).trim()

describe('the blessed empty block in a bracketed span run (carve#4077)', () => {
  it.each(['[a]{}{.b}', '[a]{}{}{.b}', '[a]{.b}{}', '[a]{ }{.b}', '[a]{.b}{ }', '[a]{}{.b}{}'])('%s adds no attribute', (src) => {
    expect(html(`${src}\n`)).toBe('<p><span class="b">a</span></p>')
  })

  it('keeps later members of the run', () => {
    expect(html('[a]{.b}{}{#i}\n')).toBe('<p><span class="b" id="i">a</span></p>')
    expect(html('[a]{}{}\n')).toBe('<p><span>a</span></p>')
  })

  it('still ends the run at a space, a tab or an invalid block', () => {
    expect(html('[a]{} {.b}\n')).toBe('<p><span>a</span> {.b}</p>')
    expect(html('[a]{}{???}\n')).toBe('<p><span>a</span>{???}</p>')
    expect(html('[a]{.b}{\t}\n')).toBe('<p><span class="b">a</span>{\t}</p>')
  })

  it('gives no other carrier an empty block', () => {
    expect(html('*x*{}{.b}\n')).toBe('<p><strong>x</strong>{}{.b}</p>')
    expect(html('`x`{}{.b}\n')).toBe('<p><code>x</code>{}{.b}</p>')
    expect(html('[a](u){}\n')).toBe('<p><a href="u">a</a>{}</p>')
  })
})
