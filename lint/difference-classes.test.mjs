// The lint differences between this engine and the Rust engine, each decided from its clause.
import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'
import { citations } from '../src/extensions/citations.ts'
import { glossary } from '../src/extensions/glossary.ts'

const codes = (source) => lint(source).map((entry) => entry.code)

describe('lint difference classes', () => {
  it('C2-B-003 and C2-B-025: owner columns exclude quote prefixes and include div opener indentation', () => {
    expect(codes('> :: a')).toEqual([])
    expect(codes('- x\n\n  :: a')).not.toContain('block-opener-overindented')
    expect(codes('::: note\n  ::: references\n  x\n  :::\n:::'))
      .toContain('block-opener-overindented')
  })

  it('C2-B-127 and C2-I-101: the reserved references placement rule has no core trigger', () => {
    expect(codes('> ::: references\n> :::')).toEqual([])
    expect(codes('::: note\n::: references\n:::\n:::'))
      .not.toContain('references-placement-in-container')
    const source = '> ::: references\n> :::'
    expect(lint(source, { extensions: glossary().extensions }).map((entry) => entry.code))
      .not.toContain('references-placement-in-container')
    expect(lint(source, { extensions: citations().extensions }).map((entry) => entry.code))
      .not.toContain('references-placement-in-container')
  })

  it('C2-N-085: without a resolver lint reports each include with include-no-resolver', () => {
    expect(codes('{{ v }}')).toEqual(['include-no-resolver'])
  })

  it('C2-W-106: a tag behind a first angle bracket is a bare HTML tag', () => {
    expect(codes('<<k>')).toEqual(['bare-html-tag'])
    expect(codes('<!-- <b> --> x')).not.toContain('bare-html-tag')
  })

  it('C2-W-106: deprecated-bare-highlight reports what 0.1 read as highlight, and no pair with an escaped closer', () => {
    expect(codes('=\\=')).toEqual([])
    expect(codes('=﻿=')).toEqual(['deprecated-bare-highlight'])
    expect(codes('_t__')).toEqual(['deprecated-bare-underline'])
    expect(codes('_f_W_')).toEqual([])
  })

  it('C2-I-077: a comment that takes no closer of a label is no comment in a reference label', () => {
    expect(codes('[ %%')).toEqual([])
    expect(codes('[x][a %% b]')).toContain('comment-in-reference-label')
  })

  it('C2-B-141: a braced comment with no closer at all is not left unclosed by an interrupter', () => {
    expect(codes('{%}')).toEqual([])
    expect(codes('a {% oops\n| b |\nc %}\n')).toContain('unclosed-braced-comment')
  })

  it('C2-B-019: a quote line inside a paragraph outside any quote reports, also below another such line', () => {
    expect(codes('{%\n> %}\n> >')).toEqual(['block-opener-without-blank-line'])
    expect(codes('> a\n> b')).toEqual([])
  })

  it('C2-B-054, C2-B-055: a marker between two open lists is read in the deeper one, and one open list is not two', () => {
    expect(codes('- - b\n - c')).toEqual(['list-marker-below-content-column'])
    expect(codes('. a\n . b')).toEqual(['list-item-body-below-content-column'])
    expect(codes('1. a\n\n 1. b')).toEqual(['list-item-body-below-content-column'])
    expect(codes('  - a\n- b')).toEqual(['uneven-list-indent'])
  })

  it('C2-W-106: a block of an item short of its content column reports without a blank line and inside a quote', () => {
    expect(codes('. a\n :::')).toContain('list-item-body-below-content-column')
    expect(codes('> . a\n>  :::')).toContain('list-item-body-below-content-column')
  })

  it('C2-W-106: an overindented block of an item inside quotes reports, as at the top', () => {
    for (const quotes of ['', '> ', '> '.repeat(70)]) {
      const found = codes(`${quotes}* x\n${quotes}\n${quotes}    # H`)
      expect(found, quotes.length.toString()).toContain('list-item-block-overindented')
      expect(found).not.toContain('block-opener-overindented')
    }
  })

  it('C2-B-127: a figure opener inside a figure group is a plain div and no panel of the group', () => {
    for (const code of ['figure-group-empty', 'figure-group-nested', 'a11y/image-alt', 'unattached-caption']) {
      expect(codes('::: figure\n::: figure\n![]()\n^ (\n:::\n^ F')).toContain(code)
    }
    for (const code of ['figure-group-empty', 'figure-group-nested', 'unattached-caption']) {
      expect(codes('::: figure\n::: figure\n:::\n^ #')).toContain(code)
    }
    expect(codes('::: figure\n> ::: figure\n> ![a](a.png)\n> :::\n:::')).toContain('figure-group-nested')
  })
})
