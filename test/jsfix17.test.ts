import { describe, expect, it } from 'vitest'
import { lint, parseWithDiagnostics, render, type CodeBlockNode } from '../public/index.ts'

const csv = 'Plan,Seats,Price\nStarter,1,"$0"\nTeam,10,"$49 billed yearly\n'
const source = '{table}\n{{ data/plans.csv @code:csv }}\n\n{{ nope.crv }}\n'
const includes = ({ path }: { path: string }) => path === 'data/plans.csv'
  ? { id: path, text: csv } : { error: 'not_found' as const }

describe('included diagnostics', () => {
  it('C2-N-085, C2-N-086: lint keeps expansion parse findings once', () => {
    const found = lint(source, { includes })
    expect(found.map(({ code, file, range }) => [code, file, range?.startOffset])).toEqual([
      ['delimited-table-malformed', 'data/plans.csv', 40],
      ['include-not-found', undefined, 40],
    ])
    expect(found.every((entry) => entry.channel === 'parse')).toBe(true)
  })

  it('C2-B-181: an included CSV quote has a range in its file after the synthetic fence is removed', () => {
    const found = parseWithDiagnostics(source, { includes }).diagnostics[0]!
    expect(found.file).toBe('data/plans.csv')
    expect(found.range).toEqual({ startOffset: 40, endOffset: 41 })
  })

  it('C2-B-181, C2-N-046: mapped quotes keep their column through selected lines', () => {
    const text = 'Preface\nName,Price\nAda,"open\n'
    const found = parseWithDiagnostics('{table}\n{{ prices.csv @lines:2-3 @code:csv }}', {
      includes: ({ path }: { path: string }) => ({ id: path, text }),
    }).diagnostics.find((entry) => entry.code === 'delimited-table-malformed')
    expect(found?.range).toEqual({ startOffset: 23, endOffset: 24 })
  })

  it('C2-N-046: record markers omitted from a CSV payload do not shift its file range', () => {
    const text = 'Name,Price\n#region r\nAda,"open\n'
    const found = parseWithDiagnostics('{table}\n{{ prices.csv @code:csv }}', {
      includes: ({ path }: { path: string }) => ({ id: path, text }),
    }).diagnostics.find((entry) => entry.code === 'delimited-table-malformed')
    expect(found?.range).toEqual({ startOffset: 25, endOffset: 26 })
  })
})

describe('public code block renderer', () => {
  it('offers language, title, attributes and safe fallback for each ordinary code block', () => {
    const seen: CodeBlockNode[] = []
    const input = '{.wide}\n```ts "Example"\nlet a = 1\n```\n\n```plain\n<hi>\n```\n'
    const html = render(input, { codeBlockRenderer(node, defaultHtml) {
      seen.push(node)
      return node.syntax === 'ts' ? '<pre data-highlighted="ts">placeholder</pre>' : defaultHtml
    } })
    expect(seen.map((node) => [node.syntax, node.value, node.title, node.attrs?.classes])).toEqual([
      ['ts', 'let a = 1\n', [{ type: 'text', value: 'Example' }], ['wide']],
      ['plain', '<hi>\n', undefined, undefined],
    ])
    expect(html).toBe('<pre data-highlighted="ts">placeholder</pre>\n<pre><code class="language-plain">&lt;hi&gt;\n</code></pre>')
  })

  it('handles nested and included code blocks and validates the hook', () => {
    const seen: string[] = []
    render('> ```js\n> x\n> ```\n\n{{ code.txt @code:ts }}', {
      includes: ({ path }: { path: string }) => ({ id: path, text: 'y\n' }),
      codeBlockRenderer(node) { seen.push(node.syntax ?? ''); return undefined },
    })
    expect(seen).toEqual(['js', 'ts'])
    expect(() => render('text', { codeBlockRenderer: 1 } as never)).toThrow('option codeBlockRenderer: not a function')
  })
})
