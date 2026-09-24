import { describe, it, expect } from 'vitest'
import { htmlToAst, htmlToCarve, migrateHtml, toAstJson } from '../src/index.js'
import type { HtmlImportMode } from '../src/index.js'

/**
 * markup-carve/carve#2254: a destination the PART 9 §25 sink blanks is not a
 * destination. Engine-local copy of the shared fixture until the spec lands it.
 */
const HTML =
  '<p><a href="javascript:alert(1)">click here</a> and <a href="Java&#9;Script:alert(1)" id="k">a named one</a></p>\n' +
  '<img src="data:text/html;base64,PHNjcmlwdD4=" alt="logo">\n'

const CARVE = 'click here and [a named one]{#k}\n\nlogo\n'

const AST = {
  type: 'document',
  children: [
    {
      type: 'paragraph',
      children: [
        { type: 'text', value: 'click here and ' },
        { type: 'span', children: [{ type: 'text', value: 'a named one' }], attrs: { id: 'k' } },
      ],
    },
    { type: 'paragraph', children: [{ type: 'text', value: 'logo' }] },
  ],
}

const row = (message: string) => ({
  code: 'attribute-dropped',
  message,
  severity: 'warning',
  fidelity: 'dropped',
  confidence: 'exact',
})

const ROWS = [
  row('Dropped href with a denied URL scheme on <a>'),
  row('Dropped href with a denied URL scheme on <a>'),
  row('Dropped src with a denied URL scheme on <img>'),
]

const withoutLocations = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutLocations)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'pos' && key !== 'srcByteLength')
      .map(([key, inner]) => [key, withoutLocations(inner)]),
  )
}

describe('an import writes no denied-scheme destination', () => {
  it('matches the shared fixture', () => {
    const carve = htmlToCarve(HTML)
    expect(carve.value).toBe(CARVE)
    expect(withoutLocations(toAstJson(htmlToAst(HTML).value))).toEqual(AST)
    expect(carve.report).toMatchObject({ mode: 'safe', adapter: 'generic' })
    expect(carve.report.diagnostics).toHaveLength(ROWS.length)
    carve.report.diagnostics.forEach((got, i) => expect(got).toMatchObject(ROWS[i]!))
  })

  for (const mode of ['safe', 'semantic', 'roundtrip'] as HtmlImportMode[]) {
    it(`drops the destination in ${mode} mode`, () => {
      const result = htmlToCarve(HTML, { mode })
      expect(result.value).toBe(CARVE)
      expect(result.report.diagnostics.map((d) => d.message)).toEqual(ROWS.map((r) => r.message))
    })
  }

  it.each([
    ['vbscript', '<p><a href="vbscript:msgbox(1)">t</a></p>'],
    ['file', '<p><a href="file:///etc/passwd">t</a></p>'],
    ['leading whitespace', '<p><a href=" javascript:x">t</a></p>'],
  ])('reads the scheme the way the sink does: %s', (_, html) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe('t\n')
    expect(result.report.diagnostics).toEqual([expect.objectContaining(row('Dropped href with a denied URL scheme on <a>'))])
  })

  it('keeps a title as an attribute once the destination is gone', () => {
    const result = htmlToCarve('<p><a href="javascript:x" title="tip">t</a></p>')
    expect(result.value).toBe('[t]{title=tip}\n')
  })

  it('keeps an allowed scheme as a link', () => {
    const result = htmlToCarve('<p><a href="https://example.com/">t</a> <img src="a.png" alt="i"></p>')
    expect(result.value).toBe('[t](https://example.com/) ![i](a.png)\n')
    expect(result.report.diagnostics).toEqual([])
  })

  it('counts as a loss for migrate', () => {
    const { report } = migrateHtml(HTML)
    expect(report.diagnostics.some(({ fidelity }) => fidelity === 'dropped')).toBe(true)
  })
})
