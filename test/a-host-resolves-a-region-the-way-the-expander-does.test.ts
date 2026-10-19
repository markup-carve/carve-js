import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, renderDocument, selectIncludeRegion } from '../src/index.js'

const carveFile = 'Intro.\n%% #region demo\nBody.\n%% #endregion demo\n'
const codeFile = 'a()\n/* #region demo */\nb()\n/* #endregion demo */\n'

function expandsRegion(file: string, directive: string): boolean {
  const src = `${directive}\n`
  const out = expandIncludes(parse(src, { positions: true }), src, { resolve: () => file })
  return out.warnings.length === 0 && !renderDocument(out.doc).includes('{{')
}

describe('selectIncludeRegion', () => {
  it('returns the 1-based content lines of a Carve-mode region', () => {
    expect(selectIncludeRegion(carveFile, 'demo', 'carve')).toEqual({ ok: true, start: 3, end: 3 })
  })

  it('uses the marker set of the mode it is asked for', () => {
    expect(selectIncludeRegion(codeFile, 'demo', 'code')).toEqual({ ok: true, start: 3, end: 3 })
    expect(selectIncludeRegion(codeFile, 'demo', 'carve')).toEqual({ ok: false, rule: 'include-region-invalid' })
  })

  it('reports an empty region as end = start - 1', () => {
    expect(selectIncludeRegion('%% #region e\n%% #endregion e\n', 'e', 'carve')).toEqual({ ok: true, start: 2, end: 1 })
  })

  it('agrees with expandIncludes on every case', () => {
    const cases: Array<[string, string, 'carve' | 'code', string]> = [
      [carveFile, 'demo', 'carve', '{{ f @region:demo }}'],
      [codeFile, 'demo', 'code', '{{ f @region:demo @code }}'],
      [codeFile, 'demo', 'carve', '{{ f @region:demo }}'],
      ['// #Region demo\nx\n// #endregion demo\n', 'demo', 'code', '{{ f @region:demo @code }}'],
    ]
    for (const [file, name, mode, directive] of cases) {
      expect(selectIncludeRegion(file, name, mode).ok, directive).toBe(expandsRegion(file, directive))
    }
  })
})
