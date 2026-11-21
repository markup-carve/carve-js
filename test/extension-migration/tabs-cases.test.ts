import { describe, expect, it } from 'vitest'
import { render, tabsExtensions, tabsRenderer, type RenderOptions } from '../../src/index.ts'
import cases from './tabs-cases.json'

describe('every captured 0.1 tabs render on the 0.2 registration', () => {
  // C2-X-048, CC-1307: authored wrapper attributes survive the tabs claim. These five captured expectations
  // predate that ruling; only their opening tag changed.
  const ruledWrappers: Record<string, string> = {
    'TB-057': '<div class="tabs" aria-label="Mine" role="group">',
    'TB-058': '<div id="t1" class="tabs" role="group" aria-label="Tabs">',
    'TB-070': '<div id="g" class="tabs" k="v" role="group" aria-label="Tabs">',
    'TB-071': '<div id="g" class="tabs" role="navigation" aria-label="Tabs">',
    'TB-072': '<div id="g" class="tabs foo" role="group" aria-label="Tabs">',
  }
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
        const opening = '<div class="tabs" role="group" aria-label="Tabs">'
        const expected = ruledWrappers[entry.id] === undefined ? entry.rewrittenHtml
          : entry.rewrittenHtml!.replace(opening, ruledWrappers[entry.id]!)
        expect(render(entry.rewrittenInput, options)).toBe(expected)
        expect(entry.rewrittenHtml === entry.html01).toBe(entry.sourceRewrite)
      }
    })
  }
})
