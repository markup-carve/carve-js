import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// markup-carve/carve#3973: X1, X5 and X6 as the spec model reads them.
describe('a guard counts where it stands (X1)', () => {
  it.each([
    ['_*x* q', '<p>_<strong>x</strong> q</p>'],
    ['_/x/ q', '<p>_<em>x</em> q</p>'],
    ['/_x_ q', '<p>/<u>x</u> q</p>'],
    ['_~x~ q', '<p>_<s>x</s> q</p>'],
    ['_=x= q', '<p>_<mark>x</mark> q</p>'],
    ['/_*x* q', '<p>/_<strong>x</strong> q</p>'],
    ['_/*a*/ q', '<p>_<strong><em>a</em></strong> q</p>'],
    ['_*a*{t="_"} b', '<p>_<strong t="_">a</strong> b</p>'],
    ['_a_ _*x* q', '<p><u>a</u> _<strong>x</strong> q</p>'],
  ])('opens after a guard that is an open entry: %s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it.each([
    ['_a _*x* q', '<p>_a _*x* q</p>'],
    ['a_*x* q', '<p>a_*x* q</p>'],
    ['\\_*x* q', '<p>_*x* q</p>'],
    ['{_a _*x*_} q', '<p><u>a _*x*</u> q</p>'],
  ])('stays blocked after a guard that is no open entry: %s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

describe('an unclosed code run takes the rest of the block (X5)', () => {
  it.each([
    ['{*a `b*} c', '<p>{*a <code>b*} c</code></p>'],
    ['{+a `b+} c', '<p>{+a <code>b+} c</code></p>'],
    ['{*a `b` c*}', '<p><strong>a <code>b</code> c</strong></p>'],
  ])('%s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

describe('an empty brace group is characters (X6)', () => {
  it.each([
    ['*a {*}', '<p><strong>a {</strong>}</p>'],
    ['*a {**} b*', '<p><strong>a {</strong>*} b*</p>'],
    ['{*a {**} b*}', '<p><strong>a {*</strong> b*}</p>'],
    ['{_{__}', '<p><u>{_</u></p>'],
    ['{*}', '<p>{*}</p>'],
  ])('%s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it.each(['*a {*}', '{_{__} b', '_*x* q', '{*a `b*} c'])('writes %j as a source that reads back', (source) => {
    const out = carveToCarve(source)
    expect(html(out)).toBe(html(source))
    expect(carveToCarve(out)).toBe(out)
  })
})
