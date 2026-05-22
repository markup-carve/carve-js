import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

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

  it('leaves a plain autolink unchanged', () => {
    expect(h('<https://x.co>')).toBe(
      '<p><a href="https://x.co">https://x.co</a></p>',
    )
  })

  it('never duplicates href, even from a later/extra attr block', () => {
    // The structural href always wins (djot + carve-php).
    expect(h('<https://x.co>{href=/other}')).toBe(
      '<p><a href="https://x.co">https://x.co</a></p>',
    )
    expect(h('<https://x.co>{.a}{href=/other}')).toBe(
      '<p><a href="https://x.co" class="a">https://x.co</a></p>',
    )
  })
})
