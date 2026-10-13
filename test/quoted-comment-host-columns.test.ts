import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/quoted-comment-host-columns.json', import.meta.url), 'utf8')) as {
  native: string
  cases: Array<{ name: string; source: string; html: string }>
}
const compact = (html: string): string => html.replace(/>\s+</g, '><').trim()

describe('quoted comments retain stored host columns', () => {
  it.each(fixture.cases)('$name matches the native ownership result', ({ source, html }) => {
    expect(compact(carveToHtml(source))).toBe(compact(html))
  })

  it.each(fixture.cases.filter(({ name }) => name.includes('second-literal')))('$name ends the quote before the final list', ({ source }) => {
    const doc = parse(source)
    expect(doc.children.map(({ type }) => type)).toEqual(['block_quote', 'list'])
  })

  it.each([1, 2])('releases the tail after a code block beneath a deeper plain item at quote depth %i', (depth) => {
    const quote = '> '.repeat(depth)
    const source = ['- ::: box', '  - inner', '    %%%', '    hidden', '    %%%', '   ```', '   code']
      .map((line) => quote + line + '\n').join('') + '- tail\n'
    const values: unknown[] = []
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) { for (const child of node) visit(child); return }
      if (node === null || typeof node !== 'object') return
      const object = node as Record<string, unknown>
      if (object.type === 'code_block') values.push(object.content)
      for (const child of Object.values(object)) visit(child)
    }
    visit(parse(source))
    expect(values).toEqual(['code\n'])
    expect(parse(source).children.map(({ type }) => type)).toEqual(['block_quote', 'list'])
  })

})
