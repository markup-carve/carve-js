import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve, parse, renderCarve } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('../spec/tests/html-code-language-cases.json', import.meta.url), 'utf8')) as Array<{ name: string; html: string; languages: Array<string | null> }>
function blocks(value: unknown): Array<{ lang?: string; content: string }> {
  if (Array.isArray(value)) return value.flatMap(blocks)
  if (!value || typeof value !== 'object') return []
  const node = value as Record<string, unknown>
  if (node.type === 'code_block') return [{ lang: node.lang as string | undefined, content: node.content as string }]
  return Object.values(node).flatMap(blocks)
}
for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
  describe(mode, () => {
    for (const fixture of cases) {
      it(fixture.name, () => {
        const ast = htmlToAst(fixture.html, { mode }).value
        expect(blocks(ast).map((b) => b.lang ?? null)).toEqual(fixture.languages)
        const source = htmlToCarve(fixture.html, { mode }).value
        expect(blocks(parse(source))).toEqual(blocks(ast))
        expect(renderCarve(parse(source))).toBe(source)
      })
    }
  })
}

it('preserves the complete representable fixture in every mode', () => {
  const root = new URL('../spec/tests/html-import/code-language-hints/', import.meta.url)
  const html = readFileSync(new URL('input.html', root), 'utf8')
  const source = readFileSync(new URL('expected.crv', root), 'utf8')
  for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
    const result = htmlToCarve(html, { mode })
    expect(result.value).toBe(source)
    expect(result.report.diagnostics).toEqual([])
    expect(renderCarve(parse(result.value))).toBe(source)
  }
})

it('keeps a raw-preserved region intact', () => {
  const html = '<figure><div class="panel"><pre data-lang="js">x</pre></div><figcaption>c</figcaption></figure>'
  const result = htmlToAst(html, { mode: 'roundtrip' })
  expect(result.value.children[0].type).toBe('raw_block')
  expect(blocks(result.value)).toEqual([])
  expect(result.report.diagnostics.map((d) => d.code)).toContain('raw-preserved')
})

it('does not rescan a shared wrapper for each pre', () => {
  const comments = '<!-- x -->'.repeat(40000)
  const pres = '<pre>x</pre>'.repeat(40000)
  const measure = (body: string): number => {
    const start = performance.now()
    expect(blocks(htmlToAst(`<div class="highlight highlight-source-js">${body}</div>`).value)).toHaveLength(40000)
    return performance.now() - start
  }
  htmlToAst(`<div>${'<pre>x</pre>'.repeat(1000)}</div>`)
  const baseline = measure(pres + comments)
  expect(measure(comments + pres)).toBeLessThan(baseline * 4 + 250)
}, 60000)
