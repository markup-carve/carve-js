import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('indented top-level block-attribute lines attach', () => {
  it('indented {.note} before a paragraph attaches', () => {
    expect(carveToHtml(' {.note}\n This paragraph.\n')).toBe('<p class="note">This paragraph.</p>')
  })

  it('indented {.todo} before a list attaches (the list opens)', () => {
    expect(carveToHtml(' {.todo}\n - one\n - two\n')).toBe('<ul class="todo">\n  <li>one</li>\n  <li>two</li>\n</ul>')
  })

  it('indented {.large #intro} before a heading attaches', () => {
    const out = carveToHtml(' {.large #intro}\n # Title\n')
    expect(out).toContain('<section id="intro">')
    expect(out).toContain('<h1 class="large">')
    expect(out.startsWith('<p>{.large ')).toBe(false)
    expect(out).not.toContain('# Title')
  })

  it('indented {.fancy #x} before a fence attaches', () => {
    const out = carveToHtml(' {.fancy #x}\n ```php\n code\n ```\n')
    expect(out).toContain('<pre')
    expect(out).toContain('class="fancy"')
    expect(out.startsWith('<p>{.fancy ')).toBe(false)
  })

  it('indented {#s .side} before a div opens the div', () => {
    const out = carveToHtml(' {#s .side}\n :::\n A div.\n :::\n')
    expect(out).toContain('<div id="s" class="side">')
    expect(out).not.toContain(':::')
    expect(out.startsWith('<p>{')).toBe(false)
  })

  it('indented {title="t"} before an admonition opens the aside', () => {
    const out = carveToHtml(' {title="t"}\n ::: note "o"\n Body.\n :::\n')
    expect(out).toContain('<aside')
    expect(out).not.toContain('::: note')
    expect(out.startsWith('<p>{title=')).toBe(false)
  })
})

describe('indented top-level image+caption forms a figure', () => {
  it('indented image + ^ caption forms a figure', () => {
    expect(carveToHtml(' ![Apollo](a.jpg)\n ^ Figure 1: moon\n')).toBe(
      '<figure>\n  <img src="a.jpg" alt="Apollo">\n  <figcaption>Figure 1: moon</figcaption>\n</figure>',
    )
  })

  it('indented {attr} + image + caption forms an attributed figure', () => {
    expect(carveToHtml(' {.gallery}\n ![Apollo](a.jpg)\n ^ Figure 1: moon\n')).toBe(
      '<figure class="gallery">\n  <img src="a.jpg" alt="Apollo">\n  <figcaption>Figure 1: moon</figcaption>\n</figure>',
    )
  })
})

describe('indented top-level reference / footnote defs register', () => {
  it('indented reference-link def is collected; the ref resolves', () => {
    expect(carveToHtml(' Read [intro][x].\n\n [x]: /intro "T"\n')).toBe(
      '<p>Read <a href="/intro" title="T">intro</a>.</p>',
    )
  })

  it('indented collapsed reference resolves', () => {
    expect(carveToHtml(' See [Other][].\n\n [Other]: /other\n')).toBe(
      '<p>See <a href="/other">Other</a>.</p>',
    )
  })

  it('indented footnote def registers (not swallowed by the link-def path)', () => {
    expect(carveToHtml(' Note[^fn].\n\n [^fn]: body.\n')).toBe(
      '<p>Note<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>.</p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>body.<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
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
