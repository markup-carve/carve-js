import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

// Fix 6: reference-definition title handles a backslash-escaped quote the same
// way inline link titles do. The ref-def title path previously truncated at the
// first inner `\`; it now allows `\"` in the run and unescapes via
// unescapeAttrValue, matching the inline title. The spec corpus stays
// byte-identical.

describe('Fix 6: reference-definition title handles backslash-escaped quote', () => {
  it('unescapes `\\"` in a ref-def title instead of truncating', () => {
    expect(h('[x][y]\n\n[y]: /u "a\\"b\\"c"')).toBe(
      '<p><a href="/u" title="a&quot;b&quot;c">x</a></p>',
    )
  })

  it('produces the same title as the inline form for the same content', () => {
    const refDef = h('[t][y]\n\n[y]: /u "a\\"b"')
    const inline = h('[t](/u "a\\"b")')
    expect(refDef).toBe(inline)
    expect(inline).toBe('<p><a href="/u" title="a&quot;b">t</a></p>')
  })

  it('still parses a plain ref-def title with no escapes', () => {
    expect(h('[x][y]\n\n[y]: /u "Title"')).toBe(
      '<p><a href="/u" title="Title">x</a></p>',
    )
  })
})
