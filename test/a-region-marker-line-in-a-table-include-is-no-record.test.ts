// markup-carve/carve#4515 (PART 10 I1d): a well-formed region marker line is no record of a table include.
import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, renderHtml, resolve } from '../src/index.js'

const render = (source: string, file: string): string =>
  renderHtml(resolve(expandIncludes(parse(source, { positions: true }), source, { resolve: () => file }).doc))

describe('a region marker line in a table include', () => {
  const file = '%% #region r\na,b\n1,2\n%% #endregion r\n3,4\n'

  it('holds no header slot and no row', () => {
    expect(render('{table}\n{{ d.csv @code:csv }}\n', file)).toBe([
      '<table>', '  <thead>', '    <tr><th scope="col">a</th><th scope="col">b</th></tr>', '  </thead>',
      '  <tbody>', '    <tr><td>1</td><td>2</td></tr>', '    <tr><td>3</td><td>4</td></tr>', '  </tbody>', '</table>',
    ].join('\n'))
  })

  it('counts toward no @rows record', () => {
    const html = render('{table}\n{{ d.csv @code:csv @rows:2-2 }}\n', file)
    expect(html).toContain('<td>1</td>')
    expect(html).not.toContain('<td>3</td>')
    expect(html).not.toContain('region')
  })

  it('is no record inside a selected region', () => {
    const html = render('{table}\n{{ d.csv @code:csv @region:o }}\n', 'Name\n%% #region o\nA\n// #region i\nB\n// #endregion i\n%% #endregion o\nC\n')
    expect(html).toContain('<td>A</td>')
    expect(html).toContain('<td>B</td>')
    expect(html).not.toContain('region')
    expect(html).not.toContain('<td>C</td>')
  })

  it('keeps a malformed marker and a quoted marker-shaped field as text', () => {
    const html = render('{table}\n{{ d.csv @code:csv }}\n', 'a\n%% #region-x\n"%% #region q"\n%% #region\n')
    expect(html).toContain('<td>%% #region-x</td>')
    expect(html).toContain('<td>%% #region q</td>')
    expect(html).toContain('<td>%% #region</td>')
  })
})
