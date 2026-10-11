import { expect, it } from 'vitest'
import vectors from './fixtures/raw-payload-termination.json'
import { parse, renderHtml, renderCarve } from '../src/index.js'
import { toAstJson, fromAstJson } from '../src/ast-json.js'
import {renderCarveWithConversionReport} from '../src/conversion-diagnostics.js'
import type { Document } from '../src/ast.js'

it.each(vectors)('decodes raw termination: $id', ({raw, codeContent}) => {
  const doc = {type: 'document', srcByteLength: 0, children: [raw]} as Document
  const back = fromAstJson(toAstJson(doc))
  expect(toAstJson(back).children).toEqual([raw])
  const code = {...doc, children: [{type: 'code_block', lang: 'html', content: codeContent}]} as Document
  expect(renderHtml(back, {allowRawHtml: false})).toBe(renderHtml(code))
  expect(renderHtml(back)).toBe(renderHtml({...doc, children: [{...raw, contentTerminated: undefined}]} as Document))
})
it.each(['', '\n', 'x', 'x\n', 'x\n\n'])('keeps EOF termination for %j', payload => {
  const source = '```=html\n' + payload
  const raw = parse(source).children[0]
  expect(raw).toMatchObject({type: 'raw_block'})
  if (raw.type !== 'raw_block') throw new Error('missing raw')
  expect(raw.contentTerminated).toBe(payload !== '' && !payload.endsWith('\n') ? false : undefined)
  expect(renderHtml(parse(source), {allowRawHtml: false})).toBe(renderHtml(parse('```html\n' + payload)))
  expect(renderCarve(parse(source))).toContain('```=html')
})
it('reports the canonical formatter termination change', () => {
  const result = renderCarveWithConversionReport(parse('```=html\nx'), renderCarve)
  expect(result.report.diagnostics).toContainEqual(expect.objectContaining({code: 'field-unspellable', field: 'contentTerminated'}))
})
it('rejects an untyped termination value', () => {
  expect(() => fromAstJson({type: 'document', srcByteLength: 0, children: [{type: 'raw_block', format: 'html', content: 'x', contentTerminated: 'false'}]} as never)).toThrow()
})

import sourceVectors from './fixtures/raw-payload-source-fixtures.json'
import { carveToHtml, Profile } from '../src/index.js'
it.each(sourceVectors)('preserves source payload in $id', ({source, codeSource, contentTerminated}) => {
  expect(carveToHtml(source, {allowRawHtml: false})).toBe(carveToHtml(codeSource))
  expect(carveToHtml(source, {profile: Profile.article()})).toBe(carveToHtml(codeSource, {profile: Profile.article()}))
  const raw = JSON.stringify(toAstJson(parse(source)))
  expect(raw.includes('"contentTerminated":false')).toBe(contentTerminated === false)
})
it('does not mark the closer as an unterminated payload line', () => {
  expect(JSON.stringify(toAstJson(parse('```=html\nx\n```')))).not.toContain('contentTerminated')
})
