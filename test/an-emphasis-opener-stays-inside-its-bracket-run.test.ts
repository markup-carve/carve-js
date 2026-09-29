import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

describe('PART 8: emphasis opened in a balanced bracket run stays inside it', () => {
  for (const [marker, tag] of [['*', 'strong'], ['/', 'em'], ['_', 'u'], ['~', 's'], ['=', 'mark']]) {
    it(`${marker} cannot close outside the run`, () => {
      expect(html(`[a ${marker}b] c${marker}`)).toBe(`<p>[a ${marker}b] c${marker}</p>`)
    })
    it(`${marker} still pairs inside the run`, () => {
      expect(html(`[a ${marker}b${marker} c]`)).toBe(`<p>[a <${tag}>b</${tag}> c]</p>`)
    })
    it(`${marker} still pairs after a failed bracket-local search`, () => {
      expect(html(`[a ${marker}b] c${marker} ${marker}d${marker}`)).toBe(
        `<p>[a ${marker}b] c${marker} <${tag}>d</${tag}></p>`,
      )
    })
  }

  it.each([
    ['[a [b *c] d*]', '<p>[a [b *c] d*]</p>'],
    ['[a *b \\] c] d*', '<p>[a *b ] c] d*</p>'],
    ['[a *b `]` c] d*', '<p>[a *b <code>]</code> c] d*</p>'],
    ['[a *b %% hidden] c*', '<p>[a *b] c*</p>'],
    ['[a *b](u) c*', '<p><a href="u">a *b</a> c*</p>'],
    ['*a [b* c]', '<p>*a [b* c]</p>'],
    ['[a *b] c', '<p>[a *b] c</p>'],
    ['[a *b c*', '<p>[a <strong>b c</strong></p>'],
    ['\\[a *b] c*', '<p>[a <strong>b] c</strong></p>'],
    ['*[a b] c*', '<p><strong>[a b] c</strong></p>'],
    ['[a /*b] c*/', '<p>[a /*b] c*/</p>'],
    ['[a /*b*/ c]', '<p>[a <strong><em>b</em></strong> c]</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))

  it.each([
    ['> [a *b] c*', '<blockquote><p>[a *b] c*</p></blockquote>'],
    ['# [a *b] c*', '<h1>[a *b] c*</h1>'],
    ['| h | i |\n|---|---|\n| [a *b] c* | y |', '<td>[a *b] c*</td>'],
  ])('bounds emphasis in %s', (source, expected) => expect(html(source)).toContain(expected))

  it('handles many sibling runs without losing later emphasis', () => {
    expect(html('[a *b] c* '.repeat(4000) + '*end*')).toBe(
      `<p>${'[a *b] c* '.repeat(4000)}<strong>end</strong></p>`,
    )
  })
})
