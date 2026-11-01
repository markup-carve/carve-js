import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const p = (source: string): string => carveToHtml(source).trim()

// carve#4641 shape 1: a `%%` that holds the arrow owns the frame's `~}`, so no substitution forms.
describe('a line comment in a substitution', () => {
  it.each([
    ['an arrow in the comment', '{~a %% b~>c~} d', '<p>{~a d</p>'],
    ['the arrow on the next line', '{~a %% b~>c\n~>d~}', '<p><del>a\n</del><ins>d</ins></p>'],
    ['a comment in the new side', '{~a~>b %% c~} d', '<p><del>a</del><ins>b</ins> d</p>'],
    ['a closed span keeps its own comment', '{~{=a %% b~>c=}~>d~} e', '<p><del><mark>a</mark></del><ins>d</ins> e</p>'],
    ['no separator is no comment', '{~a%% b~>c~} d', '<p><del>a%% b</del><ins>c</ins> d</p>'],
  ])('%s', (_name, source, html) => {
    expect(p(source)).toBe(html)
  })
})

// carve#4680: a reference label that crosses a line fails and stays verbatim, with no rescan.
describe('a reference label across a line', () => {
  it.each([
    ['link text', '[*t*][a\nb]', '<p>[*t*][a\nb]</p>'],
    ['image alt', '![*x*][a\nb]', '<p>![*x*][a\nb]</p>'],
    ['a definition with the folded label', '[a b]: /u\n\n[x][a\nb]', '<p>[x][a\nb]</p>'],
    ['no destination behind it', '[x][a\nb](u)', '<p>[x][a\nb](u)</p>'],
    ['no abbreviation in it', '*[y]: z\n\n[x][y\nq]', '<p>[x][y\nq]</p>'],
    ['a reserved label', '*[a]: k\n\n[x][@a\nb]', '<p>[x][@a\nb]</p>'],
  ])('%s', (_name, source, html) => {
    expect(p(source)).toBe(html)
  })
})

describe('a bracket span at the inline cap', () => {
  it('stays its own source, unparsed', () => {
    const html = p(`${'['.repeat(201)}*x*${']{.a}'.repeat(201)}`)
    expect(html.match(/<span/g)).toHaveLength(199)
    expect(html).toContain('[[*x*]{.a}]{.a}')
  })

  it('keeps 199 spans under bare emphasis without moving the forced-emphasis cap', () => {
    const spans = '['.repeat(199) + 'x' + ']{.a}'.repeat(199)
    const bare = p(`*w ${spans}*`)
    const forced = p(`{*w ${spans}*}`)
    expect(bare.match(/<span/g)).toHaveLength(199)
    expect(bare).toContain('<strong>w <span')
    expect(forced.match(/<span/g)).toHaveLength(198)
    expect(forced).toContain('[x]{.a}')
  })

  it('still parses a bare span inside 198 bracket spans under bare emphasis', () => {
    const source = `*w ${'['.repeat(198)}*x*${']{.a}'.repeat(198)}*`
    const html = p(source)
    expect(html.match(/<span/g)).toHaveLength(198)
    expect(html).toContain('<strong>x</strong>')
  })
})
