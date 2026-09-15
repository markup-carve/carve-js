import { describe, expect, it } from 'vitest'
import { expandIncludes, findDirectiveSites, isDirectiveShape, parse, parseDirective } from '../src/index.js'

/**
 * The recognition surface a host integration needs (carve-js#1678).
 *
 * markup-carve/obsidian-carve#23 had to answer "is this `{{ ... }}` under the
 * cursor a directive, or is it text?" without an export, and did it by running
 * the EXPANDER once per candidate with a resolver that reads nothing. These
 * tests are written the way that host would write them: through the package
 * entry only, and checked against what the engine itself does with the same
 * document rather than against the shape of the returned object.
 */

/** The engine's own answer: the paths expansion asks a resolver for, in order. */
function enginePaths(source: string): string[] {
  const asked: string[] = []
  expandIncludes(parse(source, { positions: true }), source, {
    resolve: (path) => {
      asked.push(path)
      return null
    },
  })
  return asked
}

function sitePaths(source: string): string[] {
  return findDirectiveSites(parse(source, { positions: true })).map((s) => s.directive.path)
}

const ROCKET = String.fromCodePoint(0x1f680)
const SHARP_S = String.fromCodePoint(0xdf)

describe('a host locates the directives the expander would expand', () => {
  const agree: Array<[string, string, string[]]> = [
    ['a fenced code block is not a directive site', '``` text\n{{ a.crv }}\n```\n', []],
    ['an indented-looking fence in a quote is not one either', '> ``` text\n> {{ a.crv }}\n> ```\n', []],
    ['a directive inside a code span is not', '`{{ a.crv }}`\n', []],
    ['a directive in a link destination is not', '[t](x{{a.crv}}y)\n', []],
    ['a four-space indent does not make one text, as it would in Markdown', '    {{ a.crv }}\n', ['a.crv']],
    ['a whole-paragraph directive is', '{{ a.crv }}\n', ['a.crv']],
    ['an inline directive is', 'see {{ a.crv }} here\n', ['a.crv']],
    ['one inside a blockquote is', '> {{ a.crv }}\n', ['a.crv']],
    ['one inside a list item is', '- {{ a.crv }}\n', ['a.crv']],
    ['one inside a table cell is', '| {{ a.crv }} |\n', ['a.crv']],
    ['one inside a heading is', '# h {{ a.crv }}\n', ['a.crv']],
    ['one inside emphasis is', '_{{ a.crv }}_\n', ['a.crv']],
    ['a malformed option is not, it stays literal text', '{{ a.crv @bogus:1 }}\n', []],
    ['a token with no path is not', '{{ }}\n', []],
    ['both live ones are, in document order', '{{ a.crv }}\n\ntext {{ b.crv }} text\n', ['a.crv', 'b.crv']],
    [
      'a fence between two live ones does not shift them',
      '{{ a.crv }}\n\n``` text\n{{ skip.crv }}\n```\n\n{{ b.crv }}\n',
      ['a.crv', 'b.crv'],
    ],
    ['a quoted path with a space is', '{{ "c d.crv" }}\n', ['c d.crv']],
    ['a section selector keeps the path', '{{ a.crv #sec }}\n', ['a.crv']],
  ]

  for (const [name, source, paths] of agree) {
    it(`agrees with the engine: ${name}`, () => {
      expect([name, sitePaths(source)]).toEqual([name, paths])
      expect([name, sitePaths(source)]).toEqual([name, enginePaths(source)])
    })
  }

  /** The way a host slices any node out of its buffer: `pos` offsets are codepoints. */
  function cut(source: string, site: { start: number; end: number }): string {
    return [...source].slice(site.start, site.end).join('')
  }

  const spans: Array<[string, string]> = [
    ['two plain ones in a paragraph', 'aha {{ a.crv }} und {{ b.crv }} ende\n'],
    // A section is a TAG node and an option carries a mention, so the token is
    // split across run nodes: a span measured inside the node the token STARTS
    // in stops short of the closing brace.
    ['one carrying a section', 'see {{ a.crv #sec }} end\n'],
    ['one carrying an option', 'see {{ a.crv @shift:+1 }} end\n'],
    ['one carrying both', 'see {{ a.crv #sec @shift:auto }} end\n'],
    ['a quoted path, whose delimiters are smart punctuation', 'see {{ "c d.crv" }} end\n'],
    // An astral character AHEAD of the token, in an earlier block: `pos`
    // offsets count codepoints, so a UTF-16 index added to one lands a unit
    // late per surrogate pair. In the same run it has to hold too.
    ['one behind an emoji in an earlier block', 'x ' + ROCKET + ' y\n\nsee {{ a.crv }} end\n'],
    ['one behind an emoji in the same run', 'gru' + SHARP_S + 'e ' + ROCKET + ' {{ a.crv }} ende\n'],
    ['a block-form one behind an emoji', 'x ' + ROCKET + ' y\n\n{{ a.crv #sec }}\n'],
  ]

  for (const [name, source] of spans) {
    it(`bounds the token itself: ${name}`, () => {
      const sites = findDirectiveSites(parse(source, { positions: true }))
      expect([name, sites.length > 0]).toEqual([name, true])
      for (const site of sites) expect([name, cut(source, site)]).toEqual([name, site.raw])
    })
  }

  it('reports the block form as a block and the inline form as not', () => {
    expect(findDirectiveSites(parse('{{ a.crv }}\n', { positions: true }))[0]!.block).toBe(true)
    expect(findDirectiveSites(parse('x {{ a.crv }}\n', { positions: true }))[0]!.block).toBe(false)
  })

  it('carries the parsed options through, so a host need not re-parse', () => {
    const [site] = findDirectiveSites(parse('{{ a.crv #intro @shift:+2 }}\n', { positions: true }))
    expect(site!.directive).toEqual({ raw: '{{ a.crv #intro @shift:+2 }}', path: 'a.crv', section: 'intro', shift: 2 })
  })

  it('reports a directive the expander refuses at expansion time', () => {
    // A section and a line range together is a selection CONFLICT: the expander
    // warns and never calls the resolver, so `enginePaths` cannot see it - but
    // it is a directive, not text, and go-to-definition wants it.
    const source = '{{ a.crv #s @lines:1-2 }}\n'
    expect(sitePaths(source)).toEqual(['a.crv'])
    expect(enginePaths(source)).toEqual([])
  })

  it('answers for a token a host already holds, without a document', () => {
    expect(isDirectiveShape('{{ a.crv }}')).toBe(true)
    expect(isDirectiveShape('{{ }}')).toBe(false)
    expect(parseDirective('{{ a.crv @bogus:1 }}')).toBeNull()
    expect(parseDirective('{{ a.crv }}')?.path).toBe('a.crv')
  })
})
