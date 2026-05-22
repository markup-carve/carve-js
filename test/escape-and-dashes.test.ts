import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/** Backslash escapes, non-breaking space, hard breaks (djot parity). */
describe('backslash: escape, nbsp, hard break', () => {
  it('renders backslash-space as a non-breaking space entity', () => {
    expect(h('a\\ b')).toBe('<p>a&nbsp;b</p>')
  })

  it('leaves regular spaces alone', () => {
    expect(h('a b c')).toBe('<p>a b c</p>')
  })

  it('renders a trailing backslash before a newline as a hard break', () => {
    expect(h('a\\\nb')).toBe('<p>a<br>\nb</p>')
  })

  it('tolerates trailing whitespace after the backslash for a hard break', () => {
    expect(h('a\\  \nb')).toBe('<p>a<br>\nb</p>')
  })

  it('still escapes punctuation', () => {
    expect(h('a\\*b')).toBe('<p>a*b</p>')
  })
})

/**
 * Multi-hyphen dash allocation (djot + carve-php): all em when divisible
 * by 3, all en when divisible by 2, otherwise max em + en remainder.
 */
describe('smart dashes', () => {
  it.each<[number, string]>([
    [2, '–'],
    [3, '—'],
    [4, '––'],
    [5, '—–'],
    [6, '——'],
    [7, '—––'],
    [8, '––––'],
    [9, '———'],
  ])('allocates a run of %i hyphens to %s', (n, dashes) => {
    expect(h('x' + '-'.repeat(n) + 'y')).toBe(`<p>x${dashes}y</p>`)
  })

  it('leaves a lone hyphen literal', () => {
    expect(h('a-b')).toBe('<p>a-b</p>')
  })
})

describe('autolink trailing attributes', () => {
  it('attaches a trailing {attrs} block to an autolink', () => {
    expect(h('<https://x.co>{.c}')).toBe(
      '<p><a href="https://x.co" class="c">https://x.co</a></p>',
    )
  })

  it('leaves a non-attribute brace alone', () => {
    expect(h('<https://x.co>')).toBe(
      '<p><a href="https://x.co">https://x.co</a></p>',
    )
  })
})
