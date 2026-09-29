import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type CarveExtension, fromAstJson, htmlToAst, parse, renderCarveWithConversionReport, renderHtml, renderPlainText, renderAnsi, renderMarkdown, toAstJson,
} from '../src/index.js'

function contents(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(contents)
  const node = value as Record<string, unknown>
  if (node.type === 'code_block') return [node.content as string]
  return Object.values(node).flatMap(contents)
}

const samples = JSON.parse(readFileSync(new URL('../spec/resources/ast-code-payload-samples.json', import.meta.url), 'utf8')) as Array<{ name: string; source: string; content: string }>
const fixtures = JSON.parse(readFileSync(new URL('../spec/resources/ast-code-content-fixtures.json', import.meta.url), 'utf8')) as Record<string, string[]>

describe('the pinned code payload contract', () => {
  it.each(samples)('$name', ({ source, content }) => {
    expect(contents(toAstJson(parse(source)))).toEqual([content])
    expect(renderHtml(parse(source))).toBe(`<pre><code>${content}</code></pre>`)
  })

  it.each(Object.entries(fixtures))('%s', (file, expected) => {
    const source = readFileSync(new URL(`../spec/tests/corpus/${file}`, import.meta.url), 'utf8')
    expect(contents(toAstJson(parse(source)))).toEqual(expected)
  })

  it.each(['', '\n', 'a', 'a\n', 'a\n\n'])('preserves imported and wire content %j', (content) => {
    const html = `<pre><code>${content}</code></pre>`
    const ast = htmlToAst(html).value
    expect(contents(ast)).toEqual([content])
    const decoded = fromAstJson(toAstJson(ast))
    expect(contents(decoded)).toEqual([content])
    expect(renderHtml(decoded)).toBe(html)
    const result = renderCarveWithConversionReport(decoded)
    const lossy = content !== '' && !content.endsWith('\n')
    expect(result.report.totalDiagnostics).toBe(lossy ? 1 : 0)
    if (lossy) expect(result.report.diagnostics[0]).toMatchObject({ code: 'field-unspellable', node: 'code_block', field: 'content' })
    expect(contents(parse(result.value!))).toEqual([content + (lossy ? '\n' : '')])
    expect(contents(decoded)).toEqual([content])
  })

  it.each(['a', 'a\n'])('keeps ordinary target separators for %j', (content) => {
    const ast = htmlToAst(`<pre><code>${content}</code></pre><p>after</p>`).value
    expect(renderPlainText(ast)).toBe(content + '\nafter\n')
    const ending = content.endsWith('\n') ? '\n' : ''
    expect(renderAnsi(ast)).toBe('\x1b[97m  a\x1b[0m' + ending + '\nafter\n')
    expect(renderMarkdown(ast)).toBe('```\na\n```\n\nafter\n')
    expect(contents(ast)).toEqual([content])
  })

  it('escapes literal HTML characters without appending a newline', () => {
    expect(renderHtml(parse('```\n<&>'))).toBe('<pre><code>&lt;&amp;&gt;</code></pre>')
  })

  it('reports the payload field at its source position', () => {
    const ast = parse('```\na', { positions: true })
    const result = renderCarveWithConversionReport(ast)
    expect(result.report.diagnostics).toEqual([expect.objectContaining({
      code: 'field-unspellable', node: 'code_block', field: 'content', pos: ast.children[0]!.pos,
    })])
    expect(renderCarveWithConversionReport(ast, {}, 0).report).toEqual({
      totalDiagnostics: 1, diagnostics: [], truncated: true,
    })
  })

  it.each(['> ```\n> a', '- ```\n  a', '::: note\n```\na', ':: term\n: ```\n  a'])('preserves EOF inside %j', (source) => {
    expect(contents(parse(source))).toEqual(['a'])
    expect(contents(parse(source + '\n'))).toEqual(['a\n'])
  })

  it.each(['a', 'a\n'])('uses an extension fragment\'s own EOF for %j', (payload) => {
    const extension: CarveExtension = {
      name: 'payload-fragment',
      matchBlock(lines, start, ctx) {
        if (lines[start] !== '@code') return null
        return {
          node: { type: 'block_quote', children: ctx.parseBlocks('```\n' + payload) },
          linesConsumed: 1,
        }
      },
    }
    expect(contents(parse('@code\n\n```\nb', { extensions: [extension] }))).toEqual([payload, 'b'])
  })

  it('keeps the payload break before a fragment\'s closing fence', () => {
    const extension: CarveExtension = {
      name: 'closed-payload-fragment',
      matchBlock(lines, start, ctx) {
        if (lines[start] !== '@code') return null
        return {
          node: { type: 'block_quote', children: ctx.parseBlocks('```\na\n```') },
          linesConsumed: 1,
        }
      },
    }
    expect(contents(parse('@code', { extensions: [extension] }))).toEqual(['a\n'])
    expect(contents(parse('before\n\n@code', { extensions: [extension] }))).toEqual(['a\n'])
  })

  it.each(['', 'before\n\n'])('maps a source-backed fragment after %j', (prefix) => {
    const extension: CarveExtension = {
      name: 'mapped-payload-fragment',
      matchBlock(lines, start, ctx) {
        if (lines[start] !== '@code') return null
        return {
          node: { type: 'block_quote', children: ctx.parseBlocks(lines.slice(start + 1, start + 4).join('\n')) },
          linesConsumed: 4,
        }
      },
    }
    expect(contents(parse(prefix + '@code\n```\na\n```', { extensions: [extension] }))).toEqual(['a\n'])
  })

  it.each(['\n', '\r\n', '\r'])('normalizes %j line endings', (ending) => {
    expect(contents(parse(['```', 'a', '```'].join(ending)))).toEqual(['a\n'])
  })
})
