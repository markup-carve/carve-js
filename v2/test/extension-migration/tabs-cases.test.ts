import { describe, expect, it } from 'vitest'
import { render, tabsExtensions, tabsRenderer, type RenderOptions } from '../../src/index.ts'
import cases from './tabs-cases.json'

describe('every captured 0.1 tabs render on the 0.2 registration', () => {
  for (const entry of cases) {
    it(`${entry.id}: ${entry.origin}`, () => {
      const options: RenderOptions = { extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } }
      if ('renderMode' in entry && (entry.renderMode === 'static' || entry.renderMode === 'interactive')) {
        options.mode = entry.renderMode
      }
      if ('roundtrip' in entry) options.roundtrip = entry.roundtrip
      if ('labels' in entry) options.labels = entry.labels
      expect(render(entry.input02, options)).toBe(entry.html02)
      if (entry.html01 !== entry.html02) expect(entry.clauses.length).toBeGreaterThan(0)
      if ('rewrittenInput' in entry) {
        expect(render(entry.rewrittenInput, options)).toBe(entry.rewrittenHtml)
        expect(entry.rewrittenHtml === entry.html01).toBe(entry.sourceRewrite)
      }
    })
  }
})
