import { describe, expect, it } from 'vitest'
import { bbcodeToCarve, carveToCarve, carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

const carve = (bbcode: string) => bbcodeToCarve(bbcode)
const html = (bbcode: string) => carveToHtml(carve(bbcode)).trim()

describe('a bbcode formatting tag is spelled the way the Carve writer would', () => {
  // Ruling markup-carve/carve-rs#1719: an empty element holds nothing a reader sees.
  it.each(['b', 'i', 'u', 's'])('drops an empty [%s]', (tag) => {
    expect(carve(`a [${tag}][/${tag}] b`)).toBe('a  b\n')
  })

  it.each(['sup', 'sub'])('drops an empty [%s]', (tag) => {
    expect(carve(`a [${tag}][/${tag}] b`)).toBe('a  b\n')
  })

  it('drops a tag left empty by an empty inner tag', () => {
    expect(carve('a [b][i][/i][/b] b')).toBe('a  b\n')
  })

  // CARVE-P3-013: a bare pair cannot open against whitespace or close before a word.
  it.each([
    ['a [b] x[/b] b', '<p>a <strong> x</strong> b</p>'],
    ['a [b]x [/b] b', '<p>a <strong>x </strong> b</p>'],
    ['a [u]\tx[/u] b', '<p>a <u>\tx</u> b</p>'],
    ['a[b]x[/b]b', '<p>a<strong>x</strong>b</p>'],
    ['a [i][b]x[/b][/i] b', '<p>a <em><strong>x</strong></em> b</p>'],
    ['a [b][i]x[/i][/b] b', '<p>a <strong><em>x</em></strong> b</p>'],
    ['a*[b]x[/b] b', '<p>a*<strong>x</strong> b</p>'],
    ['a/[u]x[/u] b', '<p>a/<u>x</u> b</p>'],
    ['a/[i]x[/i] b', '<p>a/<em>x</em> b</p>'],
    ['a [b]x[/b][b]y[/b] b', '<p>a <strong>x</strong><strong>y</strong> b</p>'],
    ['a [b]x[b]y[/b]z[/b] b', '<p>a <strong>xyz</strong> b</p>'],
    ['a [b]x[/b][i][/i]y b', '<p>a <strong>x</strong>y b</p>'],
    ['a [b]x[i]y b', '<p>a [b]x[i]y b</p>'],
    ['a [b]x[/i]y[/b] b', '<p>a <strong>xy</strong> b</p>'],
    ['a [B]x[/B] b', '<p>a <strong>x</strong> b</p>'],
    ['a [b]a[b]x[/b] b', '<p>a [b]a<strong>x</strong> b</p>'],
    ['a{[i]x[/i]} b', '<p>a{<em>x</em>} b</p>'],
    ['*[b]_[/b]', '<p>*<strong>_</strong></p>'],
    ['a \\*[b]x[/b] b', '<p>a \\*<strong>x</strong> b</p>'],
    ['a ~[b]x[/b]~ b', '<p>a ~<strong>x</strong>~ b</p>'],
    ['a {[b]x[/b]} b', '<p>a {<strong>x</strong>} b</p>'],
    ['a [b]x[/b][b]y[/b]z b', '<p>a <strong>x</strong><strong>y</strong>z b</p>'],
  ])('keeps %j', (bbcode, expected) => {
    expect(html(bbcode)).toBe(expected)
  })

  it('survives nesting as deep as the input limit allows', () => {
    const depth = 10000
    const tags = ['b', 'i', 'u', 's']
    const open = Array.from({ length: depth }, (_, k) => `[${tags[k % 4]}]`).join('')
    const close = Array.from({ length: depth }, (_, k) => `[/${tags[(depth - 1 - k) % 4]}]`).join('')
    expect(html(`${open}x${close}`)).toBe(html('[b][i][u][s]x[/s][/u][/i][/b]'))
  })

  perfIt('converts a run of tags in linear time', () => {
    expectScansLinearly((input) => bbcodeToCarve(input), '[b]x[/b] [i][/i]', { smallRepeats: 3000 })
  })

  perfIt('converts a run of empty tags in linear time', () => {
    expectScansLinearly((input) => bbcodeToCarve(input), '[b][/b]', { smallRepeats: 8000 })
  })

  perfIt('escapes a run of literal delimiters in linear time', () => {
    expectScansLinearly((input) => bbcodeToCarve(input), '*[b]x[/b] ', { smallRepeats: 5000 })
  })

  perfIt('converts a run of unclosed tags in linear time', () => {
    expectScansLinearly((input) => bbcodeToCarve(input), '[b]', { smallRepeats: 10000 })
  })

  it('matches the writer, so a format pass leaves the import alone', () => {
    for (const bbcode of ['a [b]x[/b]_y b', 'a*[b]x[/b] b', 'a [b] x[/b] b', 'a [i][b]x[/b][/i] b', 'x[i]*[s]a[/s]_[/i]x', 'a{[i]x[/i]} b', 'a [i][u]x[/u][/i] b', 'a [u][i]x[/i][/u] b', 'a [b][i]x[/i][/b] b']) {
      const once = carve(bbcode)
      expect(carveToCarve(once)).toBe(once)
    }
  })

  it('keeps the bare form where it reads back', () => {
    expect(carve('a [b]x[/b], [i]y[/i] b')).toBe('a *x*, /y/ b\n')
  })
})
