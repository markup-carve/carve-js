import { describe, expect, it } from 'vitest'
import { carveToHtml, expandIncludes, findDirectiveSites, parse, parseDirective, renderHtml, resolve } from '../src/index.js'

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

describe('include padding is a run of spaces', () => {
  it('leaves tab padding literal in block and inline contexts', () => {
    const source = ['{{\tc.crv\t}}', '', 'See {{\tc.crv\t}} here.'].join('\n')
    const result = expand(source, { 'c.crv': 'body\n' })
    expect(result.html).toBe(carveToHtml(source))
    expect(result.paths).toEqual([])
    expect(result.sites).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.dependencies).toEqual([])
  })

  it('expands runs of spaces around the path', () => {
    const source = ['{{   c.crv   }}', '', 'See {{   c.crv   }} here.'].join('\n')
    const result = expand(source, { 'c.crv': 'body\n' })
    expect(result.html).toBe('<p>body</p>\n<p>See body here.</p>')
    expect(result.paths).toEqual(['c.crv', 'c.crv'])
    expect(result.warnings).toEqual([])
  })

  it('keeps a tab before a section or option in the bare path', () => {
    const source = ['{{ c.crv\t#pick }}', '', '{{ c.crv\t@lines:3-3 }}'].join('\n')
    const child = ['{#pick}', '# Pick', 'body', '', '# Other', 'skip'].join('\n')
    const result = expand(source, { 'c.crv\t': child })
    expect(result.paths).toEqual(['c.crv\t', 'c.crv\t'])
    expect(result.sites.map((site) => site.directive.path)).toEqual(['c.crv\t', 'c.crv\t'])
    expect(result.html).toContain('<h1>Pick</h1>')
    expect(result.html).toContain('<p>body</p>')
    expect(result.html).not.toContain('skip')
    expect(result.warnings).toEqual([])
  })

  it('does not trim or split tabs between slots or before the closer', () => {
    const source = [
      '{{ "c.crv"\t#pick }}',
      '{{ c.crv #pick\t@shift:1 }}',
      '{{ c.crv @shift:1\t@lines:1-2 }}',
      '{{ c.crv \t}}',
      '{{ c.crv\t}}',
    ].join('\n\n')
    for (const token of source.split('\n\n')) expect(parseDirective(token)).toBeNull()
    const result = expand(source, { 'c.crv': 'body\n', 'c.crv\t': 'body\n' })
    expect(result.paths).toEqual([])
    expect(result.html).toBe(carveToHtml(source))
  })
})
