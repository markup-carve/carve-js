import { expect, it } from 'vitest'
import { renderHtml } from '../src/render-html.js'
import { parse } from '../src/parse.js'

it.each([': :::', ': # h'])('keeps a lazy line after definition-shaped paragraph text %s', marker => {
  const source = `> :: t\n>  a\n> ${marker}\nz\n`
  expect(renderHtml(parse(source))).toContain(`<p>a\n${marker}\nz</p>`)
})

it('keeps the lazy line after a comment-shaped paragraph line', () => {
  expect(renderHtml(parse('> :: t\n>  a\n> : %%%\nz\n'))).toContain('<p>a\n:\nz</p>')
})
