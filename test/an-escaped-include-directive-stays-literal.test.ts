import { describe, expect, it } from 'vitest'
import { carveToHtml, expandIncludes, findDirectiveSites, parse, renderCarve, renderHtml, resolve } from '../src/index.js'

function expand(source: string, files: Record<string, string>) {
  const paths: string[] = []
  const doc = parse(source, { positions: true })
  const sites = findDirectiveSites(doc)
  const result = expandIncludes(doc, source, {
    resolve: (path) => {
      paths.push(path)
      return files[path] ?? null
    },
  })
  return { ...result, paths, sites, html: renderHtml(resolve(result.doc)) }
}

describe('an escaped include directive stays literal', () => {
  it.each([
    ['alone on its line', '\\{{ c.crv }}'],
    ['inside a sentence', 'See \\{{ c.crv }} here.'],
    ['with a section and an option', 'See \\{{ c.crv #pick @shift:1 }} here.'],
  ])('%s', (_name, source) => {
    const result = expand(source, { 'c.crv': 'body\n' })
    expect(result.html).toBe(carveToHtml(source))
    expect(result.paths).toEqual([])
    expect(result.sites).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('still expands a live directive that follows an escaped one', () => {
    const source = 'See \\{{ a {{ c.crv }} here.'
    const result = expand(source, { 'c.crv': 'body\n' })
    expect(result.paths).toEqual(['c.crv'])
    expect(result.sites.map((site) => site.raw)).toEqual(['{{ c.crv }}'])
    expect(result.html).toBe('<p>See {{ a body here.</p>')
  })

  it('expands a directive after an escaped lone brace', () => {
    const source = 'See \\{{{ c.crv }} here.'
    const result = expand(source, { 'c.crv': 'body\n' })
    expect(result.paths).toEqual(['c.crv'])
    expect(result.html).toBe('<p>See {body here.</p>')
  })

  it.each([
    '\\{{ c.crv }}',
    'See \\{{ c.crv }} here.',
  ])('the writer keeps %s escaped', (source) => {
    const written = renderCarve(parse(source))
    expect(written).toBe(`${source}\n`)
    expect(findDirectiveSites(parse(written))).toEqual([])
  })

  it('the writer keeps a live directive that follows an escaped one', () => {
    const source = 'See \\{{ a {{ c.crv }} here.'
    const written = renderCarve(parse(source))
    expect(written).toBe(`${source}\n`)
    expect(findDirectiveSites(parse(written)).map((site) => site.raw)).toEqual(['{{ c.crv }}'])
  })
})
