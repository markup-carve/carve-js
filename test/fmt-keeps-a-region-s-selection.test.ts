import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, renderCarve, toAstJson } from '../src/index.js'

// Copied from the spec's tests/fixtures/region-marker-fmt.json (CARVE-P11-073, carve#3330).
const fixture: { rows: { id: string, source: string, fmt: string }[] } = JSON.parse(
  readFileSync(new URL('./fixtures/region-marker-fmt.json', import.meta.url), 'utf8'),
)

describe('fmt keeps a region marker on its line (CARVE-P11-073)', () => {
  for (const row of fixture.rows) {
    it(`${row.id}: fmt writes the fixture bytes`, () => {
      expect(carveToCarve(row.source)).toBe(row.fmt)
      expect(carveToCarve(row.fmt)).toBe(row.fmt)
    })
  }

  const tree = (source: string) =>
    JSON.stringify(toAstJson(parse(source)), (key, value) => (key === 'pos' || key === 'srcByteLength' ? undefined : value))

  it.each([
    // A comment that is not a marker clears X1 retention at the content column,
    // so the marker under it stays there too.
    ['- a\n%% note\n%% #endregion r\n', '- a\n  %% note\n  %% #endregion r\n'],
    // A marker retained in a nested item goes back to that item's marker column.
    ['- x\n  - y\n%% #endregion r\n', '- x\n  - y\n  %% #endregion r\n'],
    // A blank the author wrote below a list stays.
    ['- a\n\n%% #endregion r\n', '- a\n\n%% #endregion r\n'],
    // A definition above a marker is not hoisted past it, so the item keeps it.
    ['- [ref]: /url\n%% #region r\n\nSee [it][ref].\n', '- [ref]: /url\n%% #region r\n\nSee [it][ref].\n'],
  ])('%j keeps its reading', (source, expected) => {
    const written = carveToCarve(source)
    expect(written).toBe(expected)
    expect(tree(written)).toBe(tree(source))
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  it('a tree without positions keeps the ordinary separators', () => {
    const ast = parse('%% #region r\n- a\n%% #endregion r\n')
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(strip)
      if (value === null || typeof value !== 'object') return value
      return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'pos').map(([k, v]) => [k, strip(v)]))
    }
    expect(renderCarve(strip(ast) as typeof ast)).toBe('%% #region r\n\n- a\n\n%% #endregion r\n')
  })
})
