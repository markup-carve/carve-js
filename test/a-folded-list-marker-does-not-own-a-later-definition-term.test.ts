import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const modelHtml = (source: string) => carveToHtml(source).replace(/^ +(?=<)/gm, '')

describe('a folded list marker leaves no item reach in a description', () => {
  it('opens a term at the folded marker content column', () => {
    expect(modelHtml(':: t\n:  d\n  - a\n    * b\n      :: u\n      :  e\n')).toBe(
      '<dl>\n<dt>t</dt>\n<dd>\n<p>d\n- a\n* b</p>\n<dl>\n<dt>u</dt>\n<dd>e</dd>\n</dl>\n</dd>\n</dl>',
    )
  })

  it('keeps the existing owner below the folded marker content column', () => {
    expect(modelHtml(':: term\n:  detail\n  - a\n    1. ordered\n      :: term\n      :  detail\n>   +\n\ntext\n')).toBe(
      '<dl>\n<dt>term</dt>\n<dd>\n<p>detail\n- a\n1. ordered</p>\n<dl>\n<dt>term</dt>\n<dd>detail</dd>\n</dl>\n</dd>\n</dl>\n<blockquote><p>+</p></blockquote>\n<p>text</p>',
    )
  })
})
