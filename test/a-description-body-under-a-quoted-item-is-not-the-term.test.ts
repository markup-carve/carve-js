// Unmarked quote continuations fold into the open paragraph under PART 0 O1-O3.
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'


describe('unmarked description-shaped lines fold into the quoted term', () => {
  it('reads the ticket document', () => {
    expect(carveToHtml('> - :: t\n    :  a\ntail\n')).toBe("<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n:  a\ntail</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>")
  })

  it('folds at the item content column', () => {
    expect(carveToHtml('> - :: t\n  :  a\ntail\n')).toBe("<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n:  a\ntail</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>")
  })

  it('folds at document column zero', () => {
    expect(carveToHtml('> - :: t\n:  a\ntail\n')).toBe("<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a\ntail</p>")
  })

  it('folds past the item content column', () => {
    expect(carveToHtml('> - :: t\n      :  a\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n:  a</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>",
    )
  })

  it('reads a one-space separator', () => {
    expect(carveToHtml('> - :: t\n    : a\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n: a</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>",
    )
  })

  it('reads a three-space separator', () => {
    expect(carveToHtml('> - :: t\n    :   a\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n:   a</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>",
    )
  })

  it('folds under an ordered quoted item', () => {
    expect(carveToHtml('> 1. :: t\n     :  a\n')).toBe(
      "<blockquote>\n  <ol>\n    <li>\n      <dl>\n        <dt>t\n:  a</dt>\n      </dl>\n    </li>\n  </ol>\n</blockquote>",
    )
  })

  it('reads it one quote deeper', () => {
    expect(carveToHtml('> > - :: t\n      :  a\n')).toBe(
      "<blockquote>\n  <blockquote>\n    <ul>\n      <li>\n        <dl>\n          <dt>t\n:  a</dt>\n        </dl>\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>",
    )
  })

  it('reads it one item deeper', () => {
    expect(carveToHtml('> - - :: t\n      :  a\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>\n          <dl>\n            <dt>t\n:  a</dt>\n          </dl>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>",
    )
  })
})

describe('marked descriptions and container exits', () => {
  it('a description that CARRIES its `>` is the quote content it looks like, and keeps its column', () => {
    expect(carveToHtml('> - :: t\n>     :  a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n  :  a</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('an outer-column separator leaves the marker-line term', () => {
    expect(carveToHtml('> - :: t\n> :  d\n   :  b\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n  <p>:  d\n:  b</p>\n</blockquote>',
    )
  })

  it('keeps a far-indented continuation in the surviving quote paragraph', () => {
    expect(carveToHtml('> - :: t\n> :  d\n      :  b\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n  <p>:  d\n:  b</p>\n</blockquote>',
    )
  })

  it('an item holding no def list at all folds the same line as text', () => {
    expect(carveToHtml('> - a\n    :  b\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n:  b</li>\n  </ul>\n</blockquote>',
    )
  })

  it('...and ends the item where its lead leaves no paragraph open', () => {
    expect(carveToHtml('> - | a |\n  :  b\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <table>\n        <tbody>\n          <tr><td>a</td></tr>\n        </tbody>\n      </table>\n    </li>\n  </ul>\n</blockquote>\n<p>:  b</p>',
    )
  })

  it('an unquoted item reads the same columns exactly as before', () => {
    expect(carveToHtml('- :: t\n    :  a\ntail\n')).toBe(
      '<ul>\n  <li>\n    <dl>\n      <dt>t\n  :  a\ntail</dt>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('a blank line closed the quote, so the description is a paragraph outside it', () => {
    expect(carveToHtml('> - :: t\n\n    :  a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a</p>',
    )
  })
})

describe('a non-description payload at the same column', () => {
  it('a list marker folds into the term', () => {
    expect(carveToHtml('> - :: t\n    - m\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n- m</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('a heading folds into the term', () => {
    expect(carveToHtml('> - :: t\n    # h\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n# h</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('an unterminated fence stays the inline verbatim run that swallows the tail', () => {
    expect(carveToHtml('> - :: t\n    ```\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n<code>\ntail</code></dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('an unmarked second term folds into the open term', () => {
    expect(carveToHtml('> - :: t\n    :: t2\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n:: t2</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>",
    )
  })

  it('plain prose folds into the term with no residual indent', () => {
    expect(carveToHtml('> - :: t\n    plain\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\nplain</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })
})
