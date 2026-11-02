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
`, '<ul><li>x<ul><li><h1>h</h1><dl><dt>t</dt></dl></li></ul></li><li>c\ntail</li></ul>'],
  ['heading', `- # h
  :: t
 - c
tail
`, '<ul><li><h1>h</h1><dl><dt>t</dt></dl></li><li>c\ntail</li></ul>'],
  ['paragraph', `- x

  :: t
 - c
tail
`, '<ul><li>x<dl><dt>t</dt></dl></li><li>c\ntail</li></ul>'],
  ['description', `:: T
: - # h
    :: t
   - c
tail
`, '<dl><dt>T</dt><dd><ul><li><h1>h</h1><dl><dt>t</dt></dl></li><li>c\ntail</li></ul></dd></dl>'],
  ['nested heading text', `- x
  - :: t
 # c
`, '<ul><li>x<ul><li><dl><dt>t</dt></dl></li></ul></li></ul><section><h1>c</h1></section>'],
  ['ordered marker', `- # h
  :: t
 1. c
tail
`, '<ul><li><h1>h</h1><dl><dt>t</dt></dl></li></ul><ol><li>c\ntail</li></ol>'],
  ['task marker', `- # h
  :: t
 - [x] c
tail
`, '<ul><li><h1>h</h1><dl><dt>t</dt></dl></li></ul><ul class="task-list"><li data-task-state="x"><input type="checkbox" checked disabled aria-label="c tail"> c\ntail</li></ul>'],
  ['quoted marker', `> - # h
>   :: t
>  - c
> tail
`, '<blockquote><ul><li><h1>h</h1><dl><dt>t</dt></dl></li><li>c\ntail</li></ul></blockquote>'],
  ['star marker', `- # h
  :: t
 * c
tail
`, '<ul><li><h1>h</h1><dl><dt>t</dt></dl></li></ul><ul><li>c\ntail</li></ul>'],
  ['attribute-abutting marker', `- # h
  :: t
 -{.x} c
tail
`, '<ul><li><h1>h</h1><dl><dt>t</dt></dl></li><li class="x">c\ntail</li></ul>'],
]

describe('a band list marker under a term is term text', () => {
  it.each(cases)('%s', (_name, source, expected) => {
    expect(normalized(renderHtml(parse(source)))).toBe(expected)
    expect(normalized(renderHtml(parse(source, { positions: true })))).toBe(expected)
  })
})
