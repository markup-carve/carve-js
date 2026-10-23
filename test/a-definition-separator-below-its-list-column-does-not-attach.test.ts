import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a definition separator below its list column', () => {
  it('ends the item at its marker column', () => {
    expect(carveToHtml('- a\n  :: m\n: l\n: l\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>m</dt>\n    </dl>\n  </li>\n</ul>\n<p>: l\n: l</p>',
    )
  })

  it('folds in an open description below the item content column', () => {
    expect(carveToHtml('- a\n  :: m\n  :  d\n : l\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>m</dt>\n      <dd>d\n: l</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('folds into the description after a blank line in the item (carve#3547)', () => {
    expect(carveToHtml('- item\n\n  :: Term\n  :  Def\n :  under\n')).toBe(
      '<ul>\n  <li>item\n    <dl>\n      <dt>Term</dt>\n      <dd>Def\n:  under</dd>\n    </dl>\n  </li>\n</ul>',
    )
    expect(carveToHtml('- item\n\n  :: Term\n  :  Def\n\n :  under\n')).toBe(
      '<ul>\n  <li>item\n    <dl>\n      <dt>Term</dt>\n      <dd>Def</dd>\n    </dl>\n  </li>\n</ul>\n<p>:  under</p>',
    )
  })

  it('attaches at the definition list column', () => {
    expect(carveToHtml('- a\n  :: m\n  : l\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>m</dt>\n      <dd>l</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('folds a below-column separator into an open term', () => {
    expect(carveToHtml('- item\n  :: term\n :  def\n')).toBe(
      '<ul>\n  <li>item\n    <dl>\n      <dt>term\n:  def</dt>\n    </dl>\n  </li>\n</ul>',
    )
    expect(carveToHtml('- a\n  :: m\n :: n\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>m\n:: n</dt>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('folds a separator below an authored term column into the term', () => {
    expect(carveToHtml('- a\n   :: m\n  : l\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>m\n: l</dt>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('ends an item below an over-indented term', () => {
    expect(carveToHtml('- a\n   :: m\n: l\n: l\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>m</dt>\n    </dl>\n  </li>\n</ul>\n<p>: l\n: l</p>',
    )
  })

  it('attaches a lower description when the item owns the list', () => {
    expect(carveToHtml('- x\n\n    para\n    :: t\n    : d\n   :: u\n   : e\n')).toBe(
      '<ul>\n  <li><p>x</p>\n    <p>para</p>\n    <dl>\n      <dt>t</dt>\n      <dd>d</dd>\n      <dt>u</dt>\n      <dd>e</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

})
