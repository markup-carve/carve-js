import { describe, expect, it } from 'vitest'
import { render, renderWithDiagnostics } from '../public/index.ts'

describe('degraded include caption', () => {
  it('C2-H-165, C2-N-074: an unexpanded include writes its caption after its directive', () => {
    expect(render('{{ a.txt @code }}\n^ Listing #: L\n', { profile: 'minimal' }))
      .toBe('<p>{{ a.txt @code }}</p>\n<p>Listing 1: L</p>')
  })

  it('C2-H-165: the whole-block text of a degraded quote carries the caption of its include', () => {
    expect(render('> {{ a.txt @code }}\n> ^ Listing #: L\n', { profile: 'minimal' }))
      .toBe('<p>&gt; {{ a.txt @code }} Listing 1: L</p>')
  })
})

describe('paragraph emptied by a refused link', () => {
  it('C2-H-019: it writes nothing and the denied destination is still reported', () => {
    const out = renderWithDiagnostics('[](javascript:x)\n', { profile: 'comment' })
    expect(out.html).toBe('')
    expect(out.diagnostics.map((entry) => entry.code)).toEqual(['destination-denied'])
  })

  it('C2-H-008: a quote of such a paragraph is an empty container', () => {
    expect(render('> [](javascript:x)\n', { profile: 'comment' })).toBe('<blockquote>\n\n</blockquote>')
  })

  it('C2-H-007, C2-H-034: it is no visible block of an item', () => {
    expect(render('- [](javascript:x)\n\n- b\n', { profile: 'comment' })).toBe('<ul>\n  <li></li>\n  <li><p>b</p></li>\n</ul>')
    expect(render('- [](javascript:x)\n\n  after\n', { profile: 'comment' })).toBe('<ul>\n  <li>after</li>\n</ul>')
  })

  it('C2-H-006: it is no visible child of a quote', () => {
    expect(render('> [](javascript:x)\n>\n> after\n', { profile: 'comment' })).toBe('<blockquote><p>after</p></blockquote>')
  })

  it('C2-H-069: a break that no comment line takes is written, so the paragraph stays', () => {
    expect(render('[](javascript:x)\\\n', { profile: 'comment' })).toBe('<p><br>\n</p>')
    expect(render('[](javascript:x)\n{% c %}\n', { profile: 'comment' })).toBe('')
  })

  it('a link with text keeps its paragraph', () => {
    expect(render('[a](javascript:x)\n', { profile: 'comment' })).toBe('<p>a</p>')
  })
})

describe('item at the nesting bound', () => {
  it('C2-H-166: an item whose blocks leave no text keeps its <li>', () => {
    expect(render('- a\n  - %%%\n%%%\nx\n', { profile: 'minimal' }))
      .toBe('<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>')
  })
})

describe('denied link past the nesting bound', () => {
  const codes = (source: string): string[] =>
    renderWithDiagnostics(source, { profile: 'comment' }).diagnostics.map((entry) => entry.code)

  it.each(['> - [x](javascript:x)\n', '- > [x](javascript:x)\n', '> - [*x*](javascript:x)\n', '> - _[x](javascript:x)_\n'])(
    'C2-H-163, C2-H-165: %j writes the link text and reports only the denied destination', (source) => {
      expect(codes(source)).toEqual(['destination-denied'])
    })

  it('C2-H-166: a link under three containers stays, so its destination is reported', () => {
    expect(codes('> > - [x](javascript:x)\n')).toEqual(['destination-denied'])
  })
})
