import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve } from '../src/index.js'
import cases from './fixtures/code-block-child-markup.json'

describe('code block child markup', () => {
  for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
    for (const item of cases) {
      it(`${mode}: ${item.name}`, () => {
        const ast = htmlToAst(item.html, { mode })
        const source = htmlToCarve(item.html, { mode })
        const code = ast.value.children[0]
        expect(code?.type).toBe('code_block')
        if (code?.type === 'code_block') expect(code.content).toBe(item.content)
        for (const result of [ast, source]) expect(result.report.diagnostics.map(d => d.code)).toEqual(item.codes)
        expect(carveToHtml(source.value)).toContain('<p>after</p>')
        expect(carveToCarve(source.value)).toBe(source.value)
        const reparsed = htmlToAst(carveToHtml(source.value))
        expect(reparsed.value.children[0]).toMatchObject({ type: 'code_block', content: item.content && !item.content.endsWith('\n') ? item.content + '\n' : item.content })
      })
    }
    it(`${mode}: counts nested code markup toward the node limit`, () => {
      expect(() => htmlToAst('<pre><code>' + '<span>x</span>'.repeat(100) + '</code></pre>', { mode, maxNodes: 10 })).toThrow()
    })
  }
})
