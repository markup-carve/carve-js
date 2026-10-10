import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carveToHtml, markdownToCarve, parse, renderCarve, renderHtml, toAstJson } from '../src/index.js'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'
import { MAX_NESTING_DEPTH } from '../src/parse.js'

interface Vector {
  id: string
  source: string
  children?: unknown[]
  document?: unknown
  html: string
  canonical?: string
  remainingInlineDepth?: number
}
const vectors = JSON.parse(readFileSync(new URL('./fixtures/nested-braced-emphasis.json', import.meta.url), 'utf8')) as {
  cases: Vector[]; depthCases: Vector[]; hostCases: Vector[]
}
const semantic = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item: unknown) =>
  key === 'pos' || key === 'srcByteLength' || key === 'bulletChar' || key === 'number' ? undefined : item))

describe('explicit same-kind emphasis', () => {
  const malformed = JSON.parse(readFileSync(new URL('./fixtures/malformed-braced-emphasis.json', import.meta.url), 'utf8')) as Vector[]
  it.each(malformed)('$id', ({ source, html }) => {
    const document = parse(source)
    expect(renderHtml(document)).toBe(html)
    expect(renderHtml(parse(renderCarve(document)))).toBe(html)
  })

  it.each([
    ['{*a {% *} %} b*}', '<p><strong>a  b</strong></p>'],
    ['{*a {# *} #} b*}', '<p><strong>a <span class="critic-comment"> *} </span> b</strong></p>'],
    ['a {*b %% c*}', '<p>a <strong>b</strong></p>'],
    ['{*a `{*}', '<p><strong>a <code>{</code></strong></p>'],
  ])('keeps comment and unclosed-code boundaries in %s', (source, html) => {
    const document = parse(source)
    expect(renderHtml(document)).toBe(html)
    expect(renderHtml(parse(renderCarve(document)))).toBe(html)
  })

  it('keeps apparent attributes inside code from hiding attached attributes', () => {
    const source = "{*a `{k=\"` /b/{k='*}'} c\"} d*}"
    const html = renderHtml(parse(source))
    expect(html).toContain('<strong>a <code>{k="</code> <em k="*}">b</em>')
    expect(renderHtml(parse(renderCarve(parse(source))))).toBe(html)
  })

  for (const vector of [...vectors.cases, ...vectors.hostCases]) {
    if (vector.remainingInlineDepth !== undefined) continue
    it(vector.id, () => {
      const document = parse(vector.source)
      expect(renderHtml(document)).toBe(vector.html)
      const ast = toAstJson(document)
      if (vector.children) expect(semantic((ast.children[0] as { children: unknown[] }).children)).toEqual(semantic(vector.children))
      if (vector.document) expect(semantic(ast)).toEqual(semantic(vector.document))
      const written = renderCarve(document)
      expect(renderHtml(parse(written))).toBe(vector.html)
      expect(renderCarve(parse(written))).toBe(written)
      if (vector.canonical) expect(written.trimEnd()).toBe(vector.canonical)
    })
  }
  for (const vector of vectors.hostCases.filter(vector => vector.remainingInlineDepth !== undefined)) {
    it(vector.id, () => {
      const padding = MAX_NESTING_DEPTH - vector.remainingInlineDepth! - 1
      const source = vector.source.replace('{^{^x^}^}', '{/'.repeat(padding) + '{^{^x^}^}' + '/}'.repeat(padding))
      const ast = toAstJson(parse(source))
      const pending: Array<Record<string, unknown>> = [ast as unknown as Record<string, unknown>]
      let unwrapped = false
      while (pending.length) {
        const node = pending.pop()!
        const children = node.children as Array<Record<string, unknown>> | undefined
        if (children?.[0]?.type === 'emphasis') {
          let content = children
          for (let i = 0; i < padding; i++) content = content[0]!.children as Array<Record<string, unknown>>
          node.children = content
          unwrapped = true
          break
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const item of value) if (item && typeof item === 'object') pending.push(item as Record<string, unknown>)
          } else if (value && typeof value === 'object') pending.push(value as Record<string, unknown>)
        }
      }
      expect(unwrapped).toBe(true)
      expect(semantic(ast)).toEqual(semantic(vector.document))
    })
  }
  for (const vector of vectors.depthCases) {
    it(vector.id, () => {
      const padding = MAX_NESTING_DEPTH - vector.remainingInlineDepth! - 1
      const document = toAstJson(parse('{/'.repeat(padding) + vector.source + '/}'.repeat(padding)))
      let children = (document.children[0] as { children: unknown[] }).children
      for (let i = 0; i < padding; i++) children = (children[0] as { children: unknown[] }).children
      expect(semantic(children)).toEqual(semantic(vector.children))
    })
  }
})

/*
 * A Markdown import writes the nested spelling now, so its generated braces
 * meet text and escapers that never saw one before.
 */
describe('a Markdown import writing the nested spelling', () => {
  it('escapes a literal brace that would glue to the closer it wrote', () => {
    const written = markdownToCarve('**a **b {** c**')
    expect(written).toBe('{*a {*b \\{*} c*}')
    expect(carveToHtml(written).trim()).toBe('<p><strong>a <strong>b {</strong> c</strong></p>')
  })

  it('keeps the braces it wrote inside a link label out of the literal-pair escaper', () => {
    const written = markdownToCarve('[****word****](u)')
    expect(written).toBe('[{*{*word*}*}](u)')
    expect(carveToHtml(written).trim()).toBe('<p><a href="u"><strong><strong>word</strong></strong></a></p>')
  })

  it('counts the link label itself against the nesting budget', () => {
    const run = '*'.repeat(2 * (MAX_NESTING_DEPTH - 1)) + 'word' + '*'.repeat(2 * (MAX_NESTING_DEPTH - 1))
    const inside = markdownToCarveWithLosses(`[${run}](u)`)
    expect(inside.losses.map((loss) => loss.code)).toEqual(['structure-unspellable'])
    const html = renderHtml(parse(inside.value))
    // Over-budget levels flatten on the way out, so none of them comes back as
    // a literal opener on the way in.
    expect(html).not.toContain('{*')
    expect((html.match(/<strong>/g) ?? []).length).toBe(MAX_NESTING_DEPTH - 2)
  })
})
