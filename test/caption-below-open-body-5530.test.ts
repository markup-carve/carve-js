import { describe, expect, it } from 'vitest'
import { lint, parse, render } from '../public/index.ts'

// carve-js#5530. C2-B-018: a caption line without the quote's mark captions the quote whatever its last block is.
describe('C2-B-018: a caption line below a quote whose last block is an open body', () => {
  it('captions the quote when a code fence is still open', () => {
    expect(render('> ````\n^ x\n')).toBe(
      '<figure>\n  <blockquote>\n    <pre><code></code></pre>\n  </blockquote>\n  <figcaption>x</figcaption>\n</figure>',
    )
    const quote = parse('> ````\n^ x\n').children[0]
    expect(quote?.type).toBe('block_quote')
    expect(quote && 'caption' in quote && quote.caption?.type).toBe('caption')
  })

  it('reports the open fence and no unattached caption', () => {
    expect(lint('> ````\n^ x\n').map((d) => d.code)).toEqual(['unclosed-code-fence'])
  })

  it('captions the quote below an open div, an open comment block and a fence with content', () => {
    expect(render('> ::::\n^ x\n')).toContain('<figcaption>x</figcaption>')
    expect(render('> %%%\n^ x\n')).toContain('<figcaption>x</figcaption>')
    expect(render('> ```\n> a\n^ x\n')).toContain('<figcaption>x</figcaption>')
  })

  it('captions the outer quote of a nested pair and the inner one under the outer mark', () => {
    expect(render('> > ````\n^ x\n')).toBe(
      '<figure>\n  <blockquote>\n    <blockquote>\n      <pre><code></code></pre>\n    </blockquote>\n  </blockquote>\n  <figcaption>x</figcaption>\n</figure>',
    )
    expect(render('> > ````\n> ^ x\n')).toBe(
      '<blockquote>\n  <figure>\n    <blockquote>\n      <pre><code></code></pre>\n    </blockquote>\n    <figcaption>x</figcaption>\n  </figure>\n</blockquote>',
    )
  })

  it('captions a quote in an item and leaves an item without a quote to close as before', () => {
    expect(render('- > ````\n  ^ x\n')).toContain('<figcaption>x</figcaption>')
    expect(render('- ````\n^ x\n')).toBe('<ul>\n  <li>\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>^ x</p>')
  })
})
