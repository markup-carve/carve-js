import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, djotToCarve, markdownToCarve, parse, renderCarve } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/table-pipe-audit.json', import.meta.url), 'utf8')) as {
  mode: string; name: string; source: string; contains: string[]; excludes?: string[]; cells?: number; tables?: number
}[]

for (const c of cases) {
  it(`${c.mode} preserves ${c.name}`, () => {
    const source = c.mode === 'md' ? markdownToCarve(c.source) : c.mode === 'native-export' ? markdownToCarve(carveToMarkdown(c.source)) : djotToCarve(c.source)
    const html = carveToHtml(source)
    for (const fragment of c.contains) expect(html).toContain(fragment)
    for (const fragment of c.excludes ?? []) expect(html).not.toContain(fragment)
    if (c.cells !== undefined) expect(html.match(/<th\b/g) ?? []).toHaveLength(c.cells)
    if (c.tables !== undefined) expect(html.match(/<table\b/g) ?? []).toHaveLength(c.tables)
    expect(carveToHtml(renderCarve(parse(source)))).toBe(html)
  })
}
