import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A block-level construct opener fires ONLY when it begins at its container's
// content column (column 0 at the top level). Any leading indentation above that
// column means the opener does NOT fire -- the line(s) render as literal
// paragraph text. Heading / thematic-break / block-quote / fenced-code / `:::`
// openers were already strict (`^`-anchored regexes); these cases pin the
// constructs that used to be recognized while indented: a block-attribute line,
// an image+caption figure, and reference / footnote definitions. Cross-checked
// byte-for-byte against carve-php, which already implements the strict rule.
describe('strict column-0: indented block-attribute lines do NOT attach', () => {
  it('indented {.note} before a paragraph is literal', () => {
    expect(carveToHtml(' {.note}\n This paragraph.\n')).toBe('<p>{.note}\nThis paragraph.</p>')
  })

  it('indented {.todo} before a list is literal (no list opens)', () => {
    expect(carveToHtml(' {.todo}\n - one\n - two\n')).toBe('<p>{.todo}\n- one\n- two</p>')
  })

  it('indented {.large #intro} before a heading does NOT attach', () => {
    const out = carveToHtml(' {.large #intro}\n # Title\n')
    expect(out).not.toContain('<section')
    expect(out).not.toContain('<h1')
    expect(out.startsWith('<p>{.large ')).toBe(true)
    expect(out).toContain('# Title')
  })

  it('indented {.fancy #x} before a fence does NOT attach (no <pre>)', () => {
    const out = carveToHtml(' {.fancy #x}\n ```php\n code\n ```\n')
    expect(out).not.toContain('<pre')
    expect(out).not.toContain('class="fancy"')
    expect(out.startsWith('<p>{.fancy ')).toBe(true)
  })

  it('indented {#s .side} before a div does NOT open a div', () => {
    const out = carveToHtml(' {#s .side}\n :::\n A div.\n :::\n')
    expect(out).not.toContain('<div')
    expect(out).toContain(':::')
    expect(out.startsWith('<p>{')).toBe(true)
  })

  it('indented {title="t"} before an admonition does NOT open an aside', () => {
    const out = carveToHtml(' {title="t"}\n ::: note "o"\n Body.\n :::\n')
    expect(out).not.toContain('<aside')
    expect(out).toContain('::: note')
    expect(out.startsWith('<p>{title=')).toBe(true)
  })
})

describe('strict column-0: indented image+caption does NOT form a figure', () => {
  it('indented image + ^ caption stays a literal paragraph', () => {
    expect(carveToHtml(' ![Apollo](a.jpg)\n ^ Figure 1: moon\n')).toBe(
      '<p><img src="a.jpg" alt="Apollo">\n^ Figure 1: moon</p>',
    )
  })

  it('indented {attr} + image + caption stays literal (no figure, no attach)', () => {
    expect(carveToHtml(' {.gallery}\n ![Apollo](a.jpg)\n ^ Figure 1: moon\n')).toBe(
      '<p>{.gallery}\n<img src="a.jpg" alt="Apollo">\n^ Figure 1: moon</p>',
    )
  })
})

describe('strict column-0: indented reference / footnote defs are literal', () => {
  it('indented reference-link def is not collected; the ref stays unresolved', () => {
    expect(carveToHtml(' Read [intro][x].\n\n [x]: /intro "T"\n')).toBe(
      '<p>Read [intro][x].</p>\n<p>[x]: /intro “T”</p>',
    )
  })

  it('indented collapsed reference does not resolve', () => {
    expect(carveToHtml(' See [Other][].\n\n [Other]: /other\n')).toBe(
      '<p>See [Other][].</p>\n<p>[Other]: /other</p>',
    )
  })

  it('indented footnote def is literal (not swallowed by the link-def path)', () => {
    expect(carveToHtml(' Note[^fn].\n\n [^fn]: body.\n')).toBe(
      '<p>Note[^fn].</p>\n<p>[^fn]: body.</p>',
    )
  })
})

// The strict rejection must be NARROW: it applies only to a def at the true
// document top level (content column 0, outside any container). A definition
// that is indented because it sits at a *container's* content column -- a list
// item, a doubly-nested list, or a footnote body -- is still a real definition
// and its reference still resolves, matching the spec oracle. These guard the
// top-level fix from over-rejecting nested defs (regression caught in review).
describe('strict column-0: nested (container) defs still resolve', () => {
  it('def at a list-item content column resolves its reference', () => {
    expect(carveToHtml('- see [t][x].\n\n  [x]: /u\n')).toContain('<a href="/u">t</a>')
  })

  it('def at a doubly-nested list content column resolves', () => {
    expect(carveToHtml('- - see [t][x].\n\n    [x]: /u\n')).toContain('<a href="/u">t</a>')
  })

  it('def inside a footnote body resolves a reference in the note', () => {
    expect(carveToHtml('A[^n].\n\n[^n]: see [t][x].\n\n  [x]: /u\n')).toContain(
      '<a href="/u">t</a>',
    )
  })

  it('def inside a blockquote resolves', () => {
    expect(carveToHtml('> see [t][x].\n>\n> [x]: /u\n')).toContain('<a href="/u">t</a>')
  })
})

describe('strict column-0: flush (column-0) constructs still open normally', () => {
  it('flush {.large #intro} attaches to the following heading', () => {
    const out = carveToHtml('{.large #intro}\n# Title\n')
    expect(out).toContain('<section id="intro">')
    expect(out).toContain('<h1 class="large">Title</h1>')
  })

  it('flush reference-link def resolves the reference', () => {
    expect(carveToHtml('Read [intro][x].\n\n[x]: /intro "T"\n')).toContain(
      '<a href="/intro" title="T">intro</a>',
    )
  })

  it('flush image + ^ caption forms a figure', () => {
    const out = carveToHtml('![Apollo](a.jpg)\n^ Figure 1: moon\n')
    expect(out).toContain('<figure>')
    expect(out).toContain('<figcaption>Figure 1: moon</figcaption>')
  })
})
