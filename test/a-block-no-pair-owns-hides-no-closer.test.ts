import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string): string => carveToHtml(source).trim()

describe('a block after a marker that closes no pair is text to a combined token (#3925)', () => {
  it.each([
    ['/*//*{t=a*/}', '<p><strong><em>//*{t=a</em></strong>}</p>'],
    ['b /*///*{t="*/"}*/', '<p>b <strong><em>///*{t=“</em></strong>”}*/</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))

  it('still hides a closer in a block a pair owns', () => {
    expect(html('/*/{t=a*/}b')).toBe('<p><em t="a*/">*</em>b</p>')
  })

  it('still hides a closer in a closed comment', () => {
    expect(html('/*{%a*/%} b*/')).toBe('<p><strong><em> b</em></strong></p>')
  })
})

describe('a closer that closed a pair opens nothing in the walk (#3931)', () => {
  it.each([
    ['_x /a*a*/{.}q} b/{c_} c_', '<p><u>x <em>a*a*</em>{.}q} b/{c</u>} c_</p>'],
    ['_x /*a{/{.q} b/{c_} c_', '<p><u>x <em class="q">*a{</em> b/{c</u>} c_</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})

describe('a run at the start of the text attaches to nothing (#3942)', () => {
  it.each([
    ['{_=x={c_} a_ b', '<p>{<u><mark c_="">x</mark> a</u> b</p>'],
    ['/_=_={t="/"}', '<p><em><u>=</u>={t=“</em>”}</p>'],
    ['{_*~/x/~*{c_} a_ b', '<p>{<u><strong c_=""><s><em>x</em></s></strong> a</u> b</p>'],
    ['{_/*x*/{c_} c_ d/', '<p>{<u><strong c_=""><em>x</em></strong> c</u> d/</p>'],
    ['{_/=x= y/{c_} a_ b', '<p>{<u><em c_=""><mark>x</mark> y</em> a</u> b</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})
