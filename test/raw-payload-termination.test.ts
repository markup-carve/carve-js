import { expect, it } from 'vitest'
import vectors from './fixtures/raw-payload-termination.json'
import sourceVectors from './fixtures/raw-payload-source-fixtures.json'
import { parse, renderHtml, renderCarve, carveToHtml, htmlToAst, Profile } from '../src/index.js'
import { toAstJson, fromAstJson } from '../src/ast-json.js'
import { renderCarveWithConversionReport } from '../src/import/markdown/conversion-diagnostics.js'
import type { Document } from '../src/ast.js'

it.each(vectors)('retains literal raw payload: $id', ({raw, codeContent, rawPassthrough}) => {
  const doc = {type: 'document', srcByteLength: 0, children: [raw]} as Document
  const back = fromAstJson(toAstJson(doc))
  expect(toAstJson(back).children).toEqual([raw])
  const code = {...doc, children: [{type: 'code_block', lang: 'html', content: codeContent}]} as Document
  expect(renderHtml(back, {allowRawHtml: false})).toBe(renderHtml(code))
  expect(renderHtml(back)).toBe(rawPassthrough)
})

it.each(['', '\n', '\n\n', 'x', 'x\n', 'x\n\n', ' \t', '\u00a0'])('matches code at EOF for %j', payload => {
  for (const format of ['html', 'latex', 'markdown']) {
    const raw = parse('```=' + format + '\n' + payload).children[0]
    const code = parse('```' + format + '\n' + payload).children[0]
    expect(raw).toMatchObject({type: 'raw_block'})
    if (raw.type !== 'raw_block' || code.type !== 'code_block') throw new Error('missing fence')
    expect(raw.content).toBe(payload)
    expect(raw.content).toBe(code.content)
    expect(renderCarve({type: 'document', srcByteLength: 0, children: [raw]})).toContain('```=' + format)
  }
})

it('reports the canonical formatter payload change', () => {
  const result = renderCarveWithConversionReport(parse('```=html\nx'), renderCarve)
  expect(result.report.diagnostics).toContainEqual(expect.objectContaining({code: 'field-unspellable', field: 'content'}))
  if (result.value === undefined) throw new Error('missing source')
  expect(parse(result.value).children[0]).toMatchObject({type: 'raw_block', content: 'x\n'})
})

it('rejects termination metadata outside the closed schema', () => {
  expect(() => fromAstJson({type: 'document', srcByteLength: 0, children: [{type: 'raw_block', format: 'html', content: 'x', contentTerminated: false}]} as never)).toThrow()
})

it.each(sourceVectors)('preserves source payload in $id', ({source, codeSource}) => {
  expect(carveToHtml(source, {allowRawHtml: false})).toBe(carveToHtml(codeSource))
  expect(carveToHtml(source, {profile: Profile.article()})).toBe(carveToHtml(codeSource, {profile: Profile.article()}))
  expect(JSON.stringify(toAstJson(parse(source)))).not.toContain('contentTerminated')
})

it('retains the payload break before a closer', () => {
  expect(parse('```=html\nx\n```').children[0]).toMatchObject({type: 'raw_block', content: 'x\n'})
})


it.each([
  ['> ```=html\n> ', '<blockquote>\n  \n</blockquote>'],
  ['> ```=html\n> \n> ', '<blockquote>\n  \n\n</blockquote>'],
  ['> ```=html\n> x\n> \n> ', '<blockquote>\n  x\n\n</blockquote>'],
  ['- ```=html\n  \n  ', '<ul>\n  <li>\n    \n\n  </li>\n</ul>'],
])('renders marker-only EOF from its literal payload: %j', (source, html) => {
  expect(carveToHtml(source)).toBe(html)
})

it('retains imported raw HTML bytes without inventing a payload break', () => {
  const html = '<form action="/x"><input name="a"></form>'
  const doc = htmlToAst(html, {mode: 'roundtrip'}).value
  expect(doc.children[0]).toMatchObject({type: 'raw_block', content: html})
  expect(renderHtml(doc)).toBe(html)
  const code = {type: 'document', srcByteLength: 0, children: [{type: 'code_block', lang: 'html', content: html}]} as Document
  expect(renderHtml(doc, {allowRawHtml: false})).toBe(renderHtml(code))
  const result = renderCarveWithConversionReport(doc, renderCarve)
  expect(result.report.diagnostics).toContainEqual(expect.objectContaining({code: 'field-unspellable', field: 'content'}))
})
