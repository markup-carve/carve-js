// The late pass runs only when the first pass leaves a difference; each case is a minimal replay source.
import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

const cases: [string, string, string, string][] = [
  ['C2-I-024 U-432', '/*a %% b*/ y\n', '*/a{% b%}/* y\n', 'U-432'],
  ['C2-I-024 U-432', '/*a %%% b*/ y\n', '*/a{%% b%}/* y\n', 'U-432'],
  ['C2-I-023 U-432', '[a %% c] d\n', '[a{% c%}] d\n', 'U-432'],
  ['C2-B-081 U-038', '> > [r]: /u\ntail\n\n[r][]\n', '[r]: /u\n\n> >\ntail\n\n[r][]\n', 'U-038'],
  ['C2-B-081 U-038', '> [r]: /url\n> [^f]: note\n\nSee [r][] [^f].\n',
    '[^f]: note\n\n[r]: /url\n\n> {%%}\n> {%%}\n\nSee [r][] [^f].\n', 'U-038'],
  ['C2-B-081 U-039', 'See [^a].\n\n1. > [^a]: note body\n', '[^a]: note body\n\nSee [^a].\n\n1. > {%%}\n', 'U-039'],
  ['C2-I-119 U-065', '_x /*a*/{q} b/{c_} c_\n', '{_x */a/*{q} b/\\{c_}} c_\n', 'U-065'],
  ['C2-I-052 U-068', '{/a /*b*/{.k} c/}\n', '{/a */b/*{.k} c/}\n', 'U-068'],
  ['C2-I-011 U-068', '/a /*x*/ b/\n/**/ /**/\n', '/a \\/*x*/ b\\/\n{*{/\\*\\/ \\/\\*/}*}\n', 'U-068'],
  ['C2-I-011 U-273', '*a /*x*/ b*\n', '{*a \\/\\*x*}\\/ b\\*\n', 'U-273'],
  ['C2-I-011 U-273', 'a_/*y*/ x\n', 'a\\_\\/{*y*}\\/ x\n', 'U-273'],
  ['C2-I-011 U-068', '/*x*/\n*/\na_/*y*/ x\n', '{*{/x/}*}\n{*\\/\na\\_\\/\\*y*}\\/ x\n', 'U-068'],
  ['C2-I-011 U-068', '/*a\\\nb*/ y\n: *a /*x*/ b*\n', '{*{/a\\\nb/}*} y\n: {*a \\/\\*x*}\\/ b\\*\n', 'U-068'],
  ['C2-B-169 U-258', '+ c` |\n| a `b |\n', '+ c` |`\n| a `b` |\n', 'U-258'],
  ['C2-B-137 U-433', ':: t\n %% c\n   more\n', ':: t\n\n %% c\n   more\n', 'U-433'],
]

describe('the late pass', () => {
  it.each(cases)('%s writes %j as %j', (_clause, source, output, id) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(canWriteUpgrade(result)).toBe(true)
    expect(result.records.some((record) => record.entry === id)).toBe(true)
  })

  it('C2-I-104 U-375 types a straight quote that 0.2 guesses the other way', () => {
    const source = 'Exclude "a".\n> \nsee "b" here\n\nthe and/"or" too\n'
    const result = upgrade(source)
    expect(result.output).toBe('Exclude "a".\n\n> \nsee "b" here\n\nthe and/\u201cor" too\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-375')
  })

  it('C2-I-017 U-258 keeps the soft break before an empty run it explains', () => {
    const result = upgrade('> > > # H\ntail\n`\n')
    expect(result.output).toBe('> > > # H\ntail\n`\n')
    expect(result.check).toBe('explained')
  })

  it('leaves a source the first pass already upgrades as the first pass wrote it', () => {
    const result = upgrade('{_a %% b_} y\n')
    expect(result.output).toBe('{_a{% b %}_} y\n')
    expect(result.records.map((record) => record.entry)).toEqual(['U-401'])
  })
})
