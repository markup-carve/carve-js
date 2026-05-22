import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('priority-1 polish fixes', () => {
  it('uses the contextual single-quote rule (matches djot)', () => {
    // Opening before a letter in an open context; closing after a word.
    expect(h("a 'word' here")).toBe('<p>a ‘word’ here</p>')
    // A single quote before a digit is an apostrophe (decade elision),
    // so a digit-quote pair becomes apostrophes on both sides — as djot
    // renders it: '24' -> ’24’, '70s -> ’70s.
    expect(h("see '24' now")).toBe('<p>see ’24’ now</p>')
    expect(h("the '70s")).toBe('<p>the ’70s</p>')
    // Apostrophe after a word stays a closing/elision mark.
    expect(h("it's fine")).toBe('<p>it’s fine</p>')
  })

  it('does not split mixed task+plain bullets jammed under prose', () => {
    // task line then plain bullet, no blank line: stays prose
    expect(h('Text\n- [ ] todo\n- note')).toBe(
      '<p>Text\n- [ ] todo\n- note</p>',
    )
  })

  it('two same-kind bullets after prose stay prose (need a blank line, §10)', () => {
    expect(h('Text\n- a\n- b')).toBe('<p>Text\n- a\n- b</p>')
    expect(h('Text\n- [ ] a\n- [x] b')).not.toContain('<ul>')
  })

  it('preserves an attribute block on an unresolved reference', () => {
    expect(h('[missing][nope]{#x}')).toBe('<p>[missing][nope]{#x}</p>')
  })

  it('attaches an attribute block to a resolved reference', () => {
    // Attributes render in source order (`#x` then `.c`), matching djot
    // and carve-php.
    expect(h('[t][r]{#x .c}\n\n[r]: /u')).toBe(
      '<p><a href="/u" id="x" class="c">t</a></p>',
    )
  })
})
