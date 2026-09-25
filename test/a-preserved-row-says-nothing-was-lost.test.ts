/*
 * An `attribute-preserved` row is rewritten from the `attribute-dropped` row
 * recorded before the element was kept, so it must not inherit that row's
 * `dropped` fidelity. carve-php and carve-rs report `preserved`.
 */
import { describe, expect, it } from 'vitest'
import { htmlToCarve, migrateHtml } from '../src/index.js'

const roundtrip = { mode: 'roundtrip' } as const
const html = '<form onclick="a()" action="javascript:b()"><a href="javascript:c()" onclick="d()">t</a></form>'

describe('a preserved row says nothing was lost', () => {
  it('reports preserved fidelity for an own and a descendant attribute', () => {
    const rows = htmlToCarve(html, roundtrip).report.diagnostics.filter((d) => d.code === 'attribute-preserved')
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(row).toMatchObject({ fidelity: 'preserved', confidence: 'exact' })
  })

  it('says the same in the migration report', () => {
    const rows = migrateHtml(html, roundtrip).report.diagnostics.filter((d) => d.code === 'attribute-preserved')
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(row.fidelity).toBe('preserved')
  })
})
