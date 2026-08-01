import { describe, expect, it } from 'vitest'
import { carveToHtml, Profile } from '../src/index.js'

describe('a profile that denies nothing', () => {
  it('leaves a substitution intact', () => {
    const src = 'x {~old~>new~} y\n'
    expect(carveToHtml(src, { profile: Profile.full() })).toBe(carveToHtml(src))
  })

  it('leaves a symbol and a cross-reference intact', () => {
    const src = 'a :smile: b and </#T> c\n\n# T\n'
    expect(carveToHtml(src, { profile: Profile.full() })).toBe(carveToHtml(src))
  })
})

describe('an allowlist profile', () => {
  it('still denies a type it does not list', () => {
    const src = 'x {~old~>new~} y\n'
    expect(carveToHtml(src, { profile: Profile.comment() })).not.toBe(carveToHtml(src))
  })

  it('degrades the denied construct to text rather than deleting it', () => {
    const html = carveToHtml('x {~old~>new~} y\n', { profile: Profile.comment() })
    expect(html).toContain('oldnew')
  })
})
