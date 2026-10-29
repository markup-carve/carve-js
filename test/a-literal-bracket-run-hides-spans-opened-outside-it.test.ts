import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// PART 9 §9 E2b, ruled on markup-carve/carve#3897 (carve-js#3887).
describe('E2b: a literal bracket run bounds emphasis like a resolved one', () => {
  for (const [marker, tag] of [['*', 'strong'], ['/', 'em'], ['_', 'u'], ['~', 's'], ['=', 'mark']]) {
    it(`${marker} nests inside a literal run under an open ${marker} span`, () => {
      expect(html(`${marker}[${marker}g${marker}] x${marker}`)).toBe(
        `<p><${tag}>[<${tag}>g</${tag}>] x</${tag}></p>`,
      )
    })
  }

  it.each([
    ['{*a [*g*] x*}', '<p><strong>a [<strong>g</strong>] x</strong></p>'],
    ['*[*g*] [r] x*', '<p><strong>[<strong>g</strong>] [r] x</strong></p>'],
    ['*[*g*](u x*', '<p><strong>[<strong>g</strong>](u x</strong></p>'],
    ['*a [b [*g*] c] x*', '<p><strong>a [b [<strong>g</strong>] c] x</strong></p>'],
    ['*[_a *b* c_] x*', '<p><strong>[<u>a <strong>b</strong> c</u>] x</strong></p>'],
    ['/*[*g*] x*/', '<p><strong><em>[<strong>g</strong>] x</em></strong></p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))

  it('keeps E3 for a span opened inside the run', () => {
    expect(html('[*a *b* c*]')).toBe('<p>[<strong>a *b</strong> c*]</p>')
  })

  it('leaves an unresolved reference as its literal source (R1)', () => {
    expect(html('*[*g*][r] x*')).toBe('<p><strong>[*g*][r] x</strong></p>')
  })
})

// Regression rows for carve-js#3885 and #3886, fixed by #3889.
describe('closer walks read reference pairs and editorial attribute blocks as the grammar does', () => {
  it.each([
    ['*[b][a](u*) c*', '<p><strong>[b][a](u</strong>) c*</p>'],
    ['_[b][a](u_) c_', '<p><u>[b][a](u</u>) c_</p>'],
    ['{-{_a_}{title="-}"} b-}', '<p><del><u>a</u>{title=“</del>”} b-}</p>'],
    ['{+{_a_}{title="+}"} b+}', '<p><ins><u>a</u>{title=“</ins>”} b+}</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})
