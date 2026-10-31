// A block-form line below a quoted term ends that term under carve#4300.
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'


describe('unmarked description-shaped lines leave the quoted term', () => {
  it('reads the ticket document', () => {
    expect(carveToHtml('> - :: t\n    :  a\ntail\n')).toBe("<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a\ntail</p>")
  })

  it('leaves at the item content column', () => {
    expect(carveToHtml('> - :: t\n  :  a\ntail\n')).toBe("<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a\ntail</p>")
  })

  it('leaves at document column zero', () => {
    expect(carveToHtml('> - :: t\n:  a\ntail\n')).toBe("<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a\ntail</p>")
  })

  it('leaves past the item content column', () => {
    expect(carveToHtml('> - :: t\n      :  a\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a</p>",
    )
  })

  it('reads a one-space separator', () => {
    expect(carveToHtml('> - :: t\n    : a\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>: a</p>",
    )
  })

  it('reads a three-space separator', () => {
    expect(carveToHtml('> - :: t\n    :   a\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:   a</p>",
    )
  })

  it('leaves an ordered quoted item', () => {
    expect(carveToHtml('> 1. :: t\n     :  a\n')).toBe(
      "<blockquote>\n  <ol>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ol>\n</blockquote>\n<p>:  a</p>",
    )
  })

  it('reads it one quote deeper', () => {
    expect(carveToHtml('> > - :: t\n      :  a\n')).toBe(
      "<blockquote>\n  <blockquote>\n    <ul>\n      <li>\n        <dl>\n          <dt>t</dt>\n        </dl>\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>\n<p>:  a</p>",
    )
  })

  it('reads it one item deeper', () => {
    expect(carveToHtml('> - - :: t\n      :  a\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>\n          <dl>\n            <dt>t</dt>\n          </dl>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a</p>",
    )
  })
})

describe('marked descriptions and container exits', () => {
  it('a description that CARRIES its `>` describes the quoted term', () => {
    expect(carveToHtml('> - :: t\n>     :  a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n        <dd>a</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
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

  it('an unquoted item reads the same columns', () => {
    expect(carveToHtml('- :: t\n    :  a\ntail\n')).toBe(
      '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>a\ntail</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('a blank line closed the quote, so the description is a paragraph outside it', () => {
    expect(carveToHtml('> - :: t\n\n    :  a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a</p>',
    )
  })
})

describe('a non-description payload at the same column', () => {
  it('a list marker leaves the term', () => {
    expect(carveToHtml('> - :: t\n    - m\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<ul>\n  <li>m</li>\n</ul>",
    )
  })

  it('a heading leaves the quote', () => {
    expect(carveToHtml('> - :: t\n    # h\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<section id="h">\n  <h1>h</h1>\n</section>',
    )
  })

  it('an unterminated fence leaves the quote and swallows the tail', () => {
    expect(carveToHtml('> - :: t\n    ```\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<pre><code>tail\n</code></pre>',
    )
  })

  it('an unmarked second term leaves the quote', () => {
    expect(carveToHtml('> - :: t\n    :: t2\n')).toBe(
      "<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<dl>\n  <dt>t2</dt>\n</dl>",
    )
  })

  it('plain prose folds into the term with no residual indent', () => {
    expect(carveToHtml('> - :: t\n    plain\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\nplain</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })
})
