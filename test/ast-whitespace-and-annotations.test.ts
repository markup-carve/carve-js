import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, carveToCarve, carveToMarkdown, carveToPlainText,
  Profile, fromAstJson, toAstJson, readAnnotationRanges, AstSidecarError, renderCarve, renderHtml } from '../src/index.js'

describe('AST whitespace and annotation contract', () => {
  it('keeps authored private-use characters distinct from generated spaces', () => {
    const source = 'a\ue000\\ b\u00a0c\n'
    const ast = carveToAstJson(source)
    const children = (ast.children[0] as any).children
    expect(children.map((n: any) => n.type)).toEqual(['text', 'non_breaking_space', 'text'])
    expect(children[0].value).toBe('a\ue000')
    expect(children[2].value).toBe('b\u00a0c')
    expect(carveToHtml(source)).toBe('<p>a\ue000&nbsp;b&nbsp;c</p>')
    expect(carveToPlainText(source)).toBe('a\ue000 b\u00a0c\n')
    expect(carveToMarkdown(source)).toContain('a\ue000\u00a0b\u00a0c')
    expect(carveToCarve(source)).toBe(source)
    expect(toAstJson(fromAstJson(ast))).toEqual(ast)
  })

  it('uses codepoints and schema field order independently of JSON insertion order', () => {
    const fixture = JSON.parse(readFileSync(new URL('../spec/tests/fixtures/annotation-projection.json', import.meta.url), 'utf8'))
    const reverseKeys = (v: any): any => Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v
    for (const tree of [fixture.document, reverseKeys(fixture.document)]) {
      for (const range of fixture.valid) expect(() => readAnnotationRanges({ version: 1, ranges: [{ id: 'r', kind: 'test', ...range }] }, tree)).not.toThrow()
      for (const range of fixture.invalid) expect(() => readAnnotationRanges({ version: 1, ranges: [{ id: 'r', kind: 'test', ...range }] }, tree)).toThrow(AstSidecarError)
    }
  })
})

it('keeps attribute-looking source after an escaped space literal', () => {
  expect(carveToHtml('a\\ {.x}b')).toContain('a&nbsp;{.x}b')
})

it('preserves escaped spaces in built-in profiles', () => {
  for (const profile of [Profile.minimal(), Profile.comment()]) {
    expect(carveToHtml('a\\ b', { profile })).toContain('a&nbsp;b')
  }
})

it('does not interpret a literal private-use character as quote whitespace', () => {
  expect(carveToHtml('a\ue000"b"')).toContain('a\ue000”b”')
})

it('never publishes an internal line-block marker in string fields', () => {
  const source = '::: |\n![a  b](u.png) [t](x  y) [s]{title="p  q"}\n:::\n'
  expect(JSON.stringify(carveToAstJson(source))).not.toContain('\\u0000')
  expect(carveToHtml(source)).not.toContain('\0')
})

it('preserves attributes on an ingested generated space through source', () => {
  const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [{ type: 'paragraph', children: [
    { type: 'non_breaking_space', attrs: { classes: ['gap'] } },
  ] }] })
  expect(carveToHtml(renderCarve(doc))).toBe(renderHtml(doc))
})
