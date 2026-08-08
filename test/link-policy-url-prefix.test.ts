import { describe, expect, it } from 'vitest'
import { LinkPolicy } from '../src/index.js'

describe('LinkPolicy URL-prefix classification', () => {
  const internalOnly = () => new LinkPolicy().setAllowExternal(false)

  it('refuses every leading C0 authority a URL parser sends to the external host', () => {
    const trimmedByJs = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20])
    const affected = Array.from({ length: 0x20 }, (_, cp) => cp).filter(
      (cp) => !trimmedByJs.has(cp),
    )
    expect(affected).toHaveLength(27)
    for (const cp of affected) {
      expect(internalOnly().isUrlAllowed(String.fromCodePoint(cp) + '//evil.com/x')).toBe(false)
    }
  })

  it.each(['\\//evil.com/x', '\\\\evil.com/x', '/\\evil.com/x', '\\/evil.com/x'])(
    'refuses the backslash authority spelling %j',
    (url) => {
      expect(internalOnly().isUrlAllowed(url)).toBe(false)
    },
  )

  it('does not strip URL-significant Unicode spaces into an external authority', () => {
    const spaces = [
      0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
      0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
    ]
    expect(spaces).toHaveLength(19)
    for (const cp of spaces) {
      expect(internalOnly().isUrlAllowed(String.fromCodePoint(cp) + '//evil.com/x')).toBe(true)
    }
  })

  it('keeps DEL and C1 prefixes as relative-path content', () => {
    for (const cp of [0x7f, 0x80, 0x9f]) {
      expect(internalOnly().isUrlAllowed(String.fromCodePoint(cp) + '//evil.com/x')).toBe(true)
    }
  })

  it('keeps ordinary internal controls and the external controls honest', () => {
    const policy = internalOnly()
    expect(policy.isUrlAllowed('/local/x')).toBe(true)
    expect(policy.isUrlAllowed('#frag')).toBe(true)
    expect(policy.isUrlAllowed('page.crv')).toBe(true)
    expect(policy.isUrlAllowed('//evil.com/x')).toBe(false)
    expect(policy.isUrlAllowed('https://evil.com/x')).toBe(false)
  })
})
