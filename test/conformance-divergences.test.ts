import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string, o = {}) => carveToHtml(s, o)

// Five spec-conformance fixes aligning carve-js with the adjudicated canonical
// behavior (carve-rs / the grammar). See grammar.ebnf citations per block.

describe('Fix A: reference-definition destination ends at first whitespace', () => {
  // grammar.ebnf:738,741,755 -- link_destination ends at the first whitespace;
  // the rest of the line is not a valid title and is ignored, but the def still
  // registers with the bare token as its destination (it is NOT rejected).
  it('registers the def with the first token; trailing words are ignored', () => {
    expect(h('[r][r]\n\n[r]: a b c')).toBe('<p><a href="a">r</a></p>')
  })

  it('still resolves a plain URL destination', () => {
    expect(h('[r][r]\n\n[r]: http://x.com')).toBe('<p><a href="http://x.com">r</a></p>')
  })

  it('still attaches a quoted title', () => {
    expect(h('[r][r]\n\n[r]: url "title"')).toBe('<p><a href="url" title="title">r</a></p>')
  })

  it('still attaches a single-quoted title', () => {
    expect(h("[r][r]\n\n[r]: url 'title'")).toBe('<p><a href="url" title="title">r</a></p>')
  })
})

describe('Fix C: autolink body cannot contain `<`', () => {
  // grammar.ebnf:775,792 -- url_char excludes `<`/`>`, so a body `<` makes the
  // construct invalid; the whole thing is literal (matches php/rs).
  it('treats an autolink containing `<` as entirely literal', () => {
    expect(h('<http://a.com/<script>>')).toBe(
      '<p>&lt;http://a.com/&lt;script&gt;&gt;</p>',
    )
  })

  it('still forms a valid URL autolink', () => {
    expect(h('<http://a.com/>')).toBe('<p><a href="http://a.com/">http://a.com/</a></p>')
  })
})

describe('Fix G: email autolink requires a TLD; reject non-conforming', () => {
  // grammar.ebnf:776,1139 -- email_autolink = {email_char}+ '@' {email_char}+
  // '.' {letter}+ ; the `.TLD` is mandatory and email_char excludes `:`/`@`.
  it('rejects an email autolink with no TLD', () => {
    expect(h('<a@b>')).toBe('<p>&lt;a@b&gt;</p>')
  })

  it('rejects a non-conforming `:` body that is no valid scheme either', () => {
    expect(h('<x@y:z>')).toBe('<p>&lt;x@y:z&gt;</p>')
  })

  it('still forms a valid email autolink with a TLD', () => {
    expect(h('<a@b.com>')).toBe('<p><a href="mailto:a@b.com">a@b.com</a></p>')
  })

  it('keeps the leading-@ mention inside literal brackets', () => {
    expect(h('<@foo:bar>')).toBe(
      '<p>&lt;<span class="mention"><strong>@foo</strong></span>:bar&gt;</p>',
    )
  })
})

describe('Fix I: `_` is a valid extension name', () => {
  // grammar.ebnf:968-969,1122 -- extension_name = identifier =
  // (letter|'_'){letter|digit|'_'|'-'}; a lone `_` is valid. An unregistered
  // name falls back to <span class="ext-NAME"> (extensions.md:49-50).
  it('accepts a lone underscore extension name with content', () => {
    expect(h(':_[x]')).toBe('<p><span class="ext-_">x</span></p>')
  })

  it('accepts a lone underscore extension name with empty content', () => {
    expect(h(':_[]')).toBe('<p><span class="ext-_"></span></p>')
  })

  it('still accepts a normal letter-led extension name', () => {
    expect(h(':foo[bar]')).toBe('<p><span class="ext-foo">bar</span></p>')
  })
})

describe('Fix SQ: smart-quote opening context includes operator/opening punctuation', () => {
  // A straight quote curls OPENING after start, whitespace (incl. NBSP), or one
  // of `( [ { = : - /` ; otherwise CLOSING. Matches carve-rs on these inputs.
  it('opens a double quote after `=`', () => {
    expect(h('a="b"')).toBe('<p>a=“b”</p>')
  })

  it('opens a double quote after `:`', () => {
    expect(h(':"q"')).toBe('<p>:“q”</p>')
  })

  it('opens a double quote after `-`', () => {
    expect(h('-"q"')).toBe('<p>-“q”</p>')
  })

  it('opens a double quote after `/`', () => {
    expect(h('/"q"')).toBe('<p>/“q”</p>')
  })

  it('opens a double quote after `(`', () => {
    expect(h('("q")')).toBe('<p>(“q”)</p>')
  })

  it('opens a single quote after `:`', () => {
    expect(h(":'q'")).toBe('<p>:‘q’</p>')
  })

  it('opens a single quote after `/`', () => {
    expect(h("/'q'")).toBe('<p>/‘q’</p>')
  })

  it('still CLOSES a double quote after sentence punctuation', () => {
    expect(h('end."')).toBe('<p>end.”</p>')
  })
})
