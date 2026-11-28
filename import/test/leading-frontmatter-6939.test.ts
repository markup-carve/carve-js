import { describe, expect, it } from 'vitest'
import { render } from '../../src/index.ts'
import { importDocument } from '../src/index.ts'
import { commonmarkCases, gfmCases } from '../scripts/suites.ts'

const headingSource = '***\n\n== Foo\n\n== Bar\n\nBaz\n'
const doubleRuleSource = '***\n\n***\n'

function imported(input: string, from: 'markdown' | 'gfm') {
  return importDocument(input, { from })
}

function* variants(): Generator<{ input: string, from: 'markdown' | 'gfm', isMapping: boolean }> {
  const scalarBodies = ['', 'Foo\n', '# note\nFoo\n', '  Foo\n', '- item\n']
  const mappingBodies = ['title: A\n', 'title:\n', '"title": A\n', "'title': A\n", '# note\n\nname: A\n']
  const tails = ['', 'Bar\n', 'Bar\n---\nBaz\n', '***\n', '___\n', '- item\n', '> quote\n',
    '1. item\n', '# Head\n', 'plain\n\nmore\n']
  const lineEndings = [
    { eol: '\n', bom: '' }, { eol: '\r\n', bom: '' }, { eol: '\r', bom: '' },
    { eol: '\n', bom: '\uFEFF' }, { eol: '\r\n', bom: '\uFEFF' },
  ]
  for (const from of ['markdown', 'gfm'] as const)
    for (const [isMapping, bodies] of [[false, scalarBodies], [true, mappingBodies]] as const)
      for (const body of bodies)
        for (const tail of tails)
          for (const { eol, bom } of lineEndings)
            yield { from, isMapping, input: `${bom}---\n${body}---\n${tail}`.replaceAll('\n', eol) }
}

describe('leading Markdown thematic breaks (carve#6939)', () => {
  it.each([
    ['markdown', commonmarkCases, 96, headingSource],
    ['markdown', commonmarkCases, 98, doubleRuleSource],
    ['gfm', gfmCases, 66, headingSource],
    ['gfm', gfmCases, 68, doubleRuleSource],
  ] as const)('preserves official %s example %i', (from, suite, number, expected) => {
    const input = suite()[number - 1]?.input
    expect(input).toBeDefined()
    const result = imported(input!, from)
    expect(result.source).toBe(expected)
    expect(result.document.children[0]?.type).toBe('thematic_break')
    expect(render(result.source)).toContain('<hr>')
  })

  it('requires the ruled key shape and leaves explicit TOML frontmatter alone', () => {
    for (const body of ['title:Value\n', '  title: A\n', '- title: A\n', '[title]: A\n', '# comment\n']) {
      expect(imported(`---\n${body}---\n`, 'markdown').document.children[0]?.type, body).toBe('thematic_break')
    }
    for (const body of ['title: A\n', 'title:\n', '# comment\nname: A\n', '"title": A\n', "'title': A\n"]) {
      expect(imported(`---\n${body}---\n`, 'markdown').document.children[0]?.type, body).toBe('frontmatter')
    }
    expect(imported('+++\nname = "A"\n+++\n', 'markdown').document.children[0]?.type).toBe('frontmatter')
  })

  it('applies the bare-fence mapping gate to 1,000 nearby Markdown and GFM inputs', () => {
    let checked = 0
    for (const { from, isMapping, input } of variants()) {
      const result = imported(input, from)
      expect(result.document.children[0]?.type, JSON.stringify({ from, input })).toBe(
        isMapping ? 'frontmatter' : 'thematic_break')
      checked++
    }
    expect(checked).toBe(1_000)
  })
})
