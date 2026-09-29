import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const cases: { source: string, html: string }[] = JSON.parse(readFileSync(new URL('./fixtures/comment-list-content-column.json', import.meta.url), 'utf8'))
for (const { source, html } of cases) {
  it(`comments preserve the list content column: ${JSON.stringify(source)}`, () => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
}

for (const marker of ['- tail', '1. tail', '-{.y} tail', '- [x] tail']) {
  for (const depth of [1, 2, 3]) {
    it(`retained ${marker} keeps source spans at list depth ${depth}`, () => {
      const source = '- '.repeat(depth) + 'intro\n%% c\n ' + marker + '\n more\n'
      let markerSeen = false
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) return void value.forEach(visit)
        if (value === null || typeof value !== 'object') return
        const node = value as Record<string, unknown>
        const pos = node['pos'] as { startOffset: number, endOffset: number } | undefined
        if (pos) {
          expect(pos.startOffset).toBeGreaterThanOrEqual(0)
          expect(pos.endOffset).toBeGreaterThanOrEqual(pos.startOffset)
          expect(pos.endOffset).toBeLessThanOrEqual(source.length)
          if (node['type'] === 'text') {
            expect(source.slice(pos.startOffset, pos.endOffset)).toBe(node['value'])
            if (node['value'] === marker) markerSeen = true
          }
        }
        Object.values(node).forEach(visit)
      }
      visit(parse(source))
      expect(markerSeen).toBe(true)
    })
  }
}
