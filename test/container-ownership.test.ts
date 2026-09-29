import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const cases: { source: string, html: string }[] = JSON.parse(readFileSync(new URL('./fixtures/container-ownership.json', import.meta.url), 'utf8'))
const boundaries = JSON.parse(readFileSync(new URL('./fixtures/container-ownership-boundaries.json', import.meta.url), 'utf8'))
for (const { source, html } of [...cases, ...boundaries]) {
  it(`container ownership: ${JSON.stringify(source)}`, () => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
}

for (const source of [
  '- > intro\n    # café\n',
  '- > intro\n%% c\n    # café\n',
  '- - intro\n%% c\n    # café\n',
  '- - intro\n  %% c\n    # café\n',
]) {
  it(`ownership keeps text source spans: ${JSON.stringify(source)}`, () => {
    let seen = false
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return void value.forEach(visit)
      if (value === null || typeof value !== 'object') return
      const node = value as Record<string, unknown>
      const pos = node['pos'] as { startOffset: number, endOffset: number } | undefined
      if (pos && node['type'] === 'text') {
        expect(source.slice(pos.startOffset, pos.endOffset)).toBe(node['value'])
        if (String(node['value']).includes('café')) seen = true
      }
      Object.values(node).forEach(visit)
    }
    visit(parse(source))
    expect(seen).toBe(true)
  })
}
