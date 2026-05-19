import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('priority-1 polish fixes', () => {
  it('uses the spec contextual quote rule (no special decade case)', () => {
    // Paired form: opening then closing.
    expect(h("a 'word' here")).toBe('<p>a ‘word’ here</p>')
    // A genuinely quoted number opens correctly (no regression).
    expect(h("see '24' now")).toBe('<p>see ‘24’ now</p>')
    // Apostrophe after a word stays a closing/elision mark.
    expect(h("it's fine")).toBe('<p>it’s fine</p>')
  })

  it('does not split mixed task+plain bullets jammed under prose', () => {
    // task line then plain bullet, no blank line: stays prose
    expect(h('Text\n- [ ] todo\n- note')).toBe(
      '<p>Text\n- [ ] todo\n- note</p>',
    )
  })

  it('still interrupts for two same-kind bullets', () => {
    expect(h('Text\n- a\n- b')).toBe(
      '<p>Text</p>\n<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>',
    )
    expect(h('Text\n- [ ] a\n- [x] b')).toContain('<p>Text</p>')
  })

  it('preserves an attribute block on an unresolved reference', () => {
    expect(h('[missing][nope]{#x}')).toBe('<p>[missing][nope]{#x}</p>')
  })

  it('attaches an attribute block to a resolved reference', () => {
    expect(h('[t][r]{#x .c}\n\n[r]: /u')).toBe(
      '<p><a href="/u" class="c" id="x">t</a></p>',
    )
  })
})
