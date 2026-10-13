import { expect, it } from 'vitest'
import { fromAstJson, parse, renderHtml, resolve, toAstJson } from '../src/index.js'
import fixtures from './fixtures/unclosed-marker-note-fence.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

it.each(fixtures)('keeps unclosed marker-note fences and their followers in their hosts: $id', ({ source, html }) => {
  for (const positions of [false, true]) {
    const ast = resolve(parse(source, { positions }))
    expect(normalized(renderHtml(ast))).toBe(normalized(html))
    expect(normalized(renderHtml(fromAstJson(toAstJson(ast))))).toBe(normalized(html))
  }
})
