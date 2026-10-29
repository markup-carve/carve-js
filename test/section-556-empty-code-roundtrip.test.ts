import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve, parse, renderCarve, migrateMarkdown, htmlToCarve } from '../src/index.js'

for (const suffix of ['', '-2', '-3']) {
  it(`restores terminal empty code in section 556${suffix}`, () => {
    const source = readFileSync(new URL(`../spec/tests/corpus/556-a-closed-block-leaves-no-frame-for-the-line-below${suffix}.crv`, import.meta.url), 'utf8')
    const result = migrateMarkdown(carveToMarkdown(source))
    if (suffix === '') expect(renderCarve(parse(result.value))).toBe(renderCarve(parse(source)))
    expect(parse(result.value).children[0]).toMatchObject({ type: 'list', tight: true })
    expect(result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')).toEqual([])
    expect(carveToHtml(result.value, { allowRawHtml: false })).toBe(carveToHtml(source))
  })
}

it.each([
  ['- a\n  <code></code>\n\n- b', '- a\n  ``\n\n- b\n'],
  ['> a\n> <code></code>', '> a\n> ``\n'],
])('spells empty code on the final paragraph line: %s', (markdown, expected) => {
  expect(renderCarve(parse(markdownToCarve(markdown)))).toBe(expected)
})

it('keeps raw HTML when an empty code span has following paragraph text', () => {
  const result = migrateMarkdown('- a\n  <code></code> b')
  expect(result.report.diagnostics.filter(row => row.code === 'raw-code-fallback')).toHaveLength(1)
  expect(carveToHtml(result.value)).toBe('<ul>\n  <li>a\n<code></code> b</li>\n</ul>')
})

for (const suffix of ['', '-2', '-3']) {
  it(`restores the item code block in section 556${suffix}`, () => {
    const source = readFileSync(new URL(`../spec/tests/corpus/556-a-closed-block-leaves-no-frame-for-the-line-below${suffix}.crv`, import.meta.url), 'utf8')
    const imported = htmlToCarve(carveToHtml(source)).value
    const list = parse(imported).children[0]!
    expect(list.type).toBe('list')
    if (list.type !== 'list') throw new Error('Expected a list')
    expect(list.items[0]?.children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: 'a' }] })
    expect(list.items[0]?.children[1]).toMatchObject({ type: 'code_block' })
    expect(carveToHtml(imported)).toBe(carveToHtml(source))
  })
}
