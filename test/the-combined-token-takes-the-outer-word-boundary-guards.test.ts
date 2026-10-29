import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, renderCarve, renderHtml } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

/**
 * carve#3217. `bold_italic` opens with bare_opener('/') and closes with
 * bare_closer('/'): the outer `/` does not open after an ASCII letter, digit,
 * underscore or slash. It does not close before an ASCII letter or digit.
 * Once the token fails, each delimiter is read on its own. Corpus 130-4 and 601.
 */
const html = (src: string) => carveToHtml(`${src}\n`)

describe('the combined token takes the outer word-boundary guards', () => {
  it.each([
    ['a/*y*/b', '<p>a/<strong>y</strong>/b</p>'],
    ['a/*y*/ b', '<p>a/<strong>y</strong>/ b</p>'],
    ['a /*y*/b', '<p>a /<strong>y</strong>/b</p>'],
    ['2/*a*/ and /*b*/3', '<p>2/<strong>a</strong>/ and /<strong>b</strong>/3</p>'],
    ['Run src/*test*/fixtures now', '<p>Run src/<strong>test</strong>/fixtures now</p>'],
    ['see lib/*.js and src/*foo*/bar', '<p>see lib/<strong>.js and src/*foo</strong>/bar</p>'],
    ['@me/*y*/ x', '<p><span class="mention"><strong>@me</strong></span>/<strong>y</strong>/ x</p>'],
    ['_/*y*/', '<p>_<strong><em>y</em></strong></p>'],
    ['//*y*/', '<p>//<strong>y</strong>/</p>'],
  ])('reads %j as text around a bold span', (src, expected) => {
    expect(html(src)).toBe(expected)
  })

  it('lets a later valid closer end the token past a rejected one', () => {
    expect(html('/*a*/b c*/')).toBe('<p><strong><em>a*/b c</em></strong></p>')
  })

  it('still closes an open italic with the slash after a word', () => {
    expect(html('/x a/*y*/')).toBe('<p><em>x a</em><strong>y</strong>/</p>')
  })

  it('forms at a word boundary, which is the control for every row above', () => {
    expect(html('/*a*/ b')).toBe('<p><strong><em>a</em></strong> b</p>')
    expect(html('x /*a*/, b')).toBe('<p>x <strong><em>a</em></strong>, b</p>')
  })

  it.each([
    ['a_/*y*/ x', '<p>a_/<strong>y</strong>/ x</p>'],
    ['see snake_/*glob*/ now', '<p>see snake_/<strong>glob</strong>/ now</p>'],
    ['_a_/*y*/', '<p><u>a</u>/<strong>y</strong>/</p>'],
  ])('refuses %j after a `_` that opens nothing (carve#3226)', (src, expected) => {
    expect(html(src)).toBe(expected)
  })

  it('forms after a `_` that opens a span that closes (PART 9 §9)', () => {
    expect(html('_/*x*/_')).toBe('<p><u><strong><em>x</em></strong></u></p>')
    expect(html('_/*x*/ y_')).toBe('<p><u><strong><em>x</em></strong> y</u></p>')
  })

  it('emphasizes intraword through the forced form', () => {
    expect(html('a{/*y*/}b')).toBe('<p>a<em><strong>y</strong></em>b</p>')
    expect(html('a{*/y/*}b')).toBe('<p>a<strong><em>y</em></strong>b</p>')
  })
})

describe('the writer braces a combined token a word would stop', () => {
  const flagged = (before: string, after: string) => ({
    type: 'document',
    children: [{
      type: 'paragraph',
      children: [
        { type: 'text', value: before },
        { type: 'strong', boldItalic: true, children: [{ type: 'emphasis', children: [{ type: 'text', value: 'y' }] }] },
        { type: 'text', value: after },
      ],
    }],
  })

  it.each([
    ['a', 'b', 'a{*/y/*}b'],
    ['a', ' b', 'a{*/y/*} b'],
    ['a ', '2', 'a {*/y/*}2'],
    ['_', ' b', '_{*/y/*} b'],
    ['/', ' b', '\\/*/y/* b'],
  ])('writes %j + bold italic + %j in the forced form', (before, after, expected) => {
    const tree = flagged(before, after) as never
    const written = renderCarve(tree)
    expect(written).toBe(`${expected}\n`)
    expect(carveToHtml(written)).toBe(renderHtml(tree))
  })

  it('keeps the combined spelling where nothing stops it', () => {
    expect(renderCarve(flagged('a ', ' b') as never)).toBe('a /*y*/ b\n')
    expect(carveToCarve('a /*y*/ b\n')).toBe('a /*y*/ b\n')
  })
})

perfIt('guarded openers and rejected closers keep the scan linear', () => {
  for (const unit of ['a/*y*/b ', '/*a*/b ', 'src/*t*/x ']) {
    expectBuiltInputScansLinearly(
      (source) => void parse(source),
      (n) => unit.repeat(n),
      { smallRepeats: 2048, largeRepeats: 8192 },
    )
  }
})
