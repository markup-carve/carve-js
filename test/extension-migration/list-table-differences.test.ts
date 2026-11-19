import { describe, expect, it } from 'vitest'
import { render } from '../../src/index.ts'
import { listTableExtension, listTableRenderer } from '../../extensions/blocks/list-table.ts'
import fixtures from './list-table-differences.json'

describe('list table 0.1 to 0.2 differences', () => {
  for (const fixture of fixtures) {
    it(`${fixture.id}: ${fixture.test}`, () => {
      expect(fixture.input01).toBe(fixture.input02)
      expect(fixture.html01).not.toBe(fixture.html02)
      const options = 'coreComparison' in fixture && fixture.coreComparison ? {} :
        { extensions: [listTableExtension], renderers: { 'carve.listTable': listTableRenderer } }
      expect(render(fixture.input02, options).trim()).toBe(fixture.html02)
    })
  }
})
