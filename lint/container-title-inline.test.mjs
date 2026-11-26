import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const codes = (source, options) => lint(source, options).map((item) => `${item.code} ${item.range.startOffset}`)

// C2-B-120: the quoted title of a div, an admonition or a directive is inline content.
describe('inline content of a block title', () => {
  it('counts a footnote reference in a container title as a use', () => {
    expect(codes('::: note "[^a]"\n:::\n\n[^a]: B\n')).toEqual([])
  })

  it('counts a link reference in a div title as a use', () => {
    expect(codes('::: "[x][r]"\n:::\n\n[r]: /u\n')).toEqual([])
  })

  it('keeps a code fence title as text', () => {
    expect(codes('``` "[^a]"\nx\n```\n\n[^a]: B\n')).toEqual(['unused-footnote-definition 18'])
  })

  it('reports an unresolved reference in a container title', () => {
    expect(codes('> ::: tip "[^b] [x][q]"\n> :::\n').map((line) => line.split(' ')[0]).sort())
      .toEqual(['unresolved-footnote', 'unresolved-reference-link'])
  })

  it('reads the text runs of a title', () => {
    const on = { rules: { 'deprecated-bare-underline': 'on' } }
    expect(codes('::: "_x_"\n:::\n', on)).toEqual(['deprecated-bare-underline 5'])
    expect(codes('``` "_x_"\nx\n```\n', on)).toEqual(['deprecated-bare-underline 5'])
  })
})
