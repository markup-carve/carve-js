import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carveToCarve, carveToHtml } from '../src/index.js'

const shapes = JSON.parse(readFileSync(new URL('./fixtures/folded-fence-closer-shapes.json', import.meta.url), 'utf8')) as Record<string, { source: string; html: string }>

describe('folded fence closer shapes', () => {
  it.each(Object.entries(shapes))('%s renders the oracle bytes', (_name, { source, html }) => {
    expect(carveToHtml(source).replace(/\n$/, '')).toBe(html)
  })

  it.each(Object.entries(shapes))('%s preserves rendering through formatting', (_name, { source }) => {
    const formatted = carveToCarve(source)
    expect(carveToHtml(formatted)).toBe(carveToHtml(source))
    expect(carveToCarve(formatted)).toBe(formatted)
  })
})
