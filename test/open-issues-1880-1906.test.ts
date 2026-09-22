import { describe, expect, it } from 'vitest'
import { bbcodeToCarve, carveToCarve, carveToHtml } from '../src/index.js'

describe('open issue regressions', () => {
  it('keeps a list fence open when its closer follows a below-column line', () => {
    expect(carveToHtml('- a\n  ```\n  b\n y\n  ```').trim()).toBe(
      '<ul>\n  <li>a\n    <pre><code>b\n</code></pre>\n  </li>\n</ul>\n<p>y\n<code></code></p>',
    )
  })

  it('does not use a flush-left fence as a description block closer', () => {
    expect(carveToHtml(':: t\n: a\n  ```\n  b\n y\n```').trim()).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>a\n<code>\nb\ny\n</code></dd>\n</dl>',
    )
  })

  it('does not rescue a marker-line colon opener with a closer', () => {
    expect(carveToHtml('- :::\n y\n  :::').trim()).toBe('<ul>\n  <li>:::\ny\n    <div>\n    </div>\n  </li>\n</ul>')
  })

  it('lets a line comment consume bare emphasis closers', () => {
    const source = '*a %% b* y\n\n_a %% b_ y\n\n/a %% b/ y\n\n/*a %% b*/ y'
    expect(carveToHtml(source).trim()).toBe(
      '<p>*a</p>\n<p>_a</p>\n<p>/a</p>\n<p><strong><em>a</em></strong> y</p>',
    )
    expect(carveToHtml('*a %% b\nc* y').trim()).toBe('<p><strong>a\nc</strong> y</p>')
  })

  it('numbers a caption placeholder glued to the preceding word', () => {
    const source = '![p](p.png)\n^ Figure#* q'
    expect(carveToHtml(source).trim()).toBe(
      '<figure>\n  <img src="p.png" alt="p">\n  <figcaption>Figure1* q</figcaption>\n</figure>',
    )
    expect(carveToHtml('![p](p.png)\n^ Figure x#tag q')).toContain('<figcaption>Figure x#tag q</figcaption>')
  })

  it('does not close critic additions or deletions inside an unclosed code run', () => {
    expect(carveToHtml('{+a`b\\+}').trim()).toBe('<p>{+a<code>b\\+}</code></p>')
    expect(carveToHtml('{-a`b\\-}').trim()).toBe('<p>{-a<code>b\\-}</code></p>')
  })

  it('escapes every BBCode line-initial list or description opener', () => {
    expect(bbcodeToCarve('a. a\nI) a\n:: a')).toBe('a\\. a\nI\\) a\n\\:: a\n')
  })

  it('keeps braces around a forced span containing a line comment', () => {
    for (const [open, close] of [
      ['*', '*'],
      ['_', '_'],
      ['~', '~'],
      ['/', '/'],
      ['=', '='],
      ['^', '^'],
      [',', ','],
    ]) {
      const source = `{${open}a %% b${close}} y`
      expect(carveToCarve(source).trim()).toBe(source)
    }
  })
})
