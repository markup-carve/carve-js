import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const modelHtml = (source: string) => carveToHtml(source).replace(/^ +(?=<)/gm, '')

// A marker that misses the description body closes it and opens a list (PART 0 S3, carve#4860).
describe('a list marker below a description body column closes the description', () => {
  it('opens a term at the nested marker content column', () => {
    expect(modelHtml(':: t\n:  d\n  - a\n    * b\n      :: u\n      :  e\n')).toBe(
      '<dl>\n<dt>t</dt>\n<dd>d</dd>\n</dl>\n<ul>\n<li>a\n<ul>\n<li>b\n<dl>\n<dt>u</dt>\n<dd>e</dd>\n</dl>\n</li>\n</ul>\n</li>\n</ul>',
    )
  })

  it('keeps the existing owner below the nested marker content column', () => {
    expect(modelHtml(':: term\n:  detail\n  - a\n    1. ordered\n      :: term\n      :  detail\n>   +\n\ntext\n')).toBe(
      '<dl>\n<dt>term</dt>\n<dd>detail</dd>\n</dl>\n<ul>\n<li>a\n<ol>\n<li>ordered</li>\n</ol>\n<dl>\n<dt>term</dt>\n<dd>detail</dd>\n</dl>\n</li>\n</ul>\n<blockquote><p>+</p></blockquote>\n<p>text</p>',
    )
  })
})
