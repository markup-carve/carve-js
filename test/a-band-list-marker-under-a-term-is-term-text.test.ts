import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const normalized = (html: string) => html
  .replace(/ id="[^"]*"/g, '')
  .replace(/>\s+</g, '><')
  .replace(/(<li>x)\s+(<dl>|<ul>)/g, '$1$2')
  .trim()

const cases = [
  ['descendant term', `- x
  - # h
    :: t
 - c
tail
`, '<ul><li>x<ul><li><h1>h</h1><dl><dt>t\n- c\ntail</dt></dl></li></ul></li></ul>'],
  ['heading', `- # h
  :: t
 - c
tail
`, '<ul><li><h1>h</h1><dl><dt>t\n- c\ntail</dt></dl></li></ul>'],
  ['paragraph', `- x

  :: t
 - c
tail
`, '<ul><li>x<dl><dt>t\n- c\ntail</dt></dl></li></ul>'],
  ['description', `:: T
: - # h
    :: t
   - c
tail
`, '<dl><dt>T</dt><dd><ul><li><h1>h</h1><dl><dt>t\n- c\ntail</dt></dl></li></ul></dd></dl>'],
  ['nested heading text', `- x
  - :: t
 # c
`, '<ul><li>x<ul><li><dl><dt>t\n# c</dt></dl></li></ul></li></ul>'],
  ['ordered marker', `- # h
  :: t
 1. c
tail
`, '<ul><li><h1>h</h1><dl><dt>t\n1. c\ntail</dt></dl></li></ul>'],
  ['task marker', `- # h
  :: t
 - [x] c
tail
`, '<ul><li><h1>h</h1><dl><dt>t\n- [x] c\ntail</dt></dl></li></ul>'],
  ['quoted marker', `> - # h
>   :: t
>  - c
> tail
`, '<blockquote><ul><li><h1>h</h1><dl><dt>t\n- c\ntail</dt></dl></li></ul></blockquote>'],
  ['star marker', `- # h
  :: t
 * c
tail
`, '<ul><li><h1>h</h1><dl><dt>t\n* c\ntail</dt></dl></li></ul>'],
  ['attribute-abutting marker', `- # h
  :: t
 -{.x} c
tail
`, '<ul><li><h1>h</h1><dl><dt>t\n-{.x} c\ntail</dt></dl></li></ul>'],
]

describe('a band list marker under a term is term text', () => {
  it.each(cases)('%s', (_name, source, expected) => {
    expect(normalized(renderHtml(parse(source)))).toBe(expected)
    expect(normalized(renderHtml(parse(source, { positions: true })))).toBe(expected)
  })
})
