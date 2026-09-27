import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve } from '../src/index.js'

/** Code spans retain text bytes and report lost block boundaries. */
describe('a code span reports the boundary blocks lose inside it', () => {
  it('keeps the fixture bytes and reports the boundary before its descendants', () => {
    const fixture = (name: string) => readFileSync(new URL(`../spec/tests/html-import/code-span-holding-blocks/${name}`, import.meta.url), 'utf8')
    const html = fixture('input.html')
    const source = htmlToCarve(html)
    expect(source.value).toBe(fixture('expected.crv'))
    expect(source.value).toBe('`foobar`\n')
    for (const result of [htmlToAst(html), source]) {
      expect(result.report.diagnostics).toMatchObject(JSON.parse(fixture('expected.report.json')).diagnostics)
    }
  })

  it.each([
    ['<code><div>a</div></code>', 'a', 0],
    ['<code>x<div>y</div></code>', 'xy', 1],
    ['<code>a</code>', 'a', 0],
    ['<code><b>a</b></code>', 'a', 0],
    ['<code><div>a</div><div></div><div>b</div></code>', 'ab', 1],
    ['<code><div>a</div><div>b</div><div>c</div></code>', 'abc', 1],
  ])('counts lost boundaries in %s', (html, value, count) => {
    const ast = htmlToAst(html)
    const source = htmlToCarve(html)
    expect(ast.value.children).toEqual([{ type: 'paragraph', children: [{ type: 'code', value }] }])
    expect(source.value).toBe(`\`${value}\`\n`)
    for (const result of [ast, source]) {
      expect(result.report.diagnostics.filter((row) => row.code === 'structure-unspellable')).toHaveLength(count)
    }
  })

  it('keeps unsupported-element wording outside code spans', () => {
    const result = htmlToAst('<code><div>a</div></code><span><div>b</div></span>')
    expect(result.report.diagnostics.filter((row) => row.code === 'element-unwrapped' && /<div>/.test(row.message)).map((row) => row.message)).toEqual([
      'Unwrapped <div> inside <code>',
      'Unwrapped unsupported <div> element',
    ])
  })
})
