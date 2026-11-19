import { describe, expect, it } from 'vitest'
import { render } from '../../src/index.ts'
import { listTableExtension, listTableRenderer } from '../../extensions/blocks/list-table.ts'
import cases from './list-integrations.json'

describe('0.1 list table integration inputs', () => {
  for (const entry of cases) {
    it(`${entry.id}: ${entry.title}`, () => {
      const html = render(entry.input02, { extensions: [listTableExtension], renderers: { 'carve.listTable': listTableRenderer } }).trim()
      expect(entry.input01).toBe(entry.input02)
      if (entry.held) {
        expect(html).toContain('<table>')
        expect(html.match(/div-label/g)).toHaveLength(1)
      } else expect(html).toBe(entry.html02)
      if (entry.html01 !== entry.html02 && !entry.held) expect(entry.clauses.length).toBeGreaterThan(0)
    })
  }
})
