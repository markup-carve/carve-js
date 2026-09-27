import { expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

it.each(["- - p `a\n > b` q\n", "- 1. p `a\n > b` q\n", "- p\n\n  - q `a\n > b` r\n", "r[^n]\n\n[^n]: p `a\n  [x]: y` q\n", "r[^n]\n\n[^n]: - p `a\n   > b` q\n", "> - - p `a\n>  > b` q\n", "- p `a\n > b` q\n", "- p `a\n >\nb` q\n", "- p `a\n [x]: y` q\n", "> - p `a\n>  > b` q\n", '`\n\t> x\n', '~``` x\n[d]: u ```\n', '`\n``\n', '`\n``x\n', '1. [d]: u\n', '- A\n{x}\n*[A]: }\n'])(
  'preserves rendered content when formatting %j',
  (source) => {
    const formatted = renderCarve(parse(source))
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(renderCarve(parse(formatted))).toBe(formatted)
  },
)

it('ends an abbreviation prepass list at a block attribute line', () => {
  expect(carveToHtml('- A\n{x}\n*[A]: }\n')).toContain('<abbr title="}">A</abbr>')
})

it.each([':: p `X` q\n  definition\n', 'r[^n]\n\n[^n]: p `X` q\n'])(
  'refuses unspellable constructed code in %j', (source) => {
    for (const value of ['a\n> b', 'a\n>\nb', 'a\n[x]: y', 'a\r> b']) {
      if (source.startsWith('r[') && value.includes('[x]')) continue
      const doc = parse(source)
      const visit = (node: unknown): void => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) { node.forEach(visit); return }
        const record = node as Record<string, unknown>
        if (record.type === 'code') record.value = value
        else Object.values(record).forEach(visit)
      }
      visit(doc)
      expect(() => renderCarve(doc)).toThrow(/cannot spell code/)
    }
  },
)

it('allocates heading suffixes without reusing an existing heading id', () => {
  const source = '# A\n# A-2\n# A\n'
  expect(carveToHtml(source)).toContain('id="A-3"')
})

it('normalizes a constructed carriage return before guarding a quote line', () => {
  const out = renderCarve({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'code', value: 'a\r> b' }] }] })
  expect(out).toBe('`a\n > b`\n')
  expect(carveToHtml(out)).toContain('<code>a\n&gt; b</code>')
})
