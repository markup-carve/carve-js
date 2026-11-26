import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'
import { importDocument } from '../public/formats.ts'

function fromHtml(html: string): { source: string, codes: string[] } {
  const result = importDocument(html, { from: 'html' })
  return { source: result.source, codes: result.diagnostics.map((item) => item.code) }
}

describe('carve#6788: revision keys on render (C2-H-210)', () => {
  it('maps the keys in lower case only', () => {
    expect(render('{+x+}{Author=Ann}\n')).toBe('<p><ins Author="Ann">x</ins></p>')
    expect(render('{#x#}{DateTime=1}\n')).toBe('<p><span class="critic-comment" DateTime="1">x</span></p>')
  })

  it('keeps each key in its place among the attributes', () => {
    expect(render('{-x-}{k=1 author=Ann cite=/r datetime=2}\n')).toBe('<p><del k="1" data-author="Ann" cite="/r" datetime="2">x</del></p>')
  })

  it('an authored data-datetime wins on the comment span', () => {
    expect(render('{#x#}{datetime=1 data-datetime=2}\n')).toBe('<p><span class="critic-comment" data-datetime="2">x</span></p>')
  })

  it('datetime on another node stays an ordinary attribute', () => {
    expect(render('*x*{author=Ann datetime=1}\n')).toBe('<p><strong author="Ann" datetime="1">x</strong></p>')
  })
})

describe('carve#6788: revision keys on import (C2-M-044)', () => {
  it('a data-author beside an authored author keeps its name', () => {
    expect(fromHtml('<ins author="A" data-author="B">x</ins>').source).toBe('{+x+}{author=A data-author=B}\n')
  })

  it('data-datetime on <ins> is not a revision key', () => {
    expect(fromHtml('<ins data-datetime="1">x</ins>').source).toBe('{+x+}{data-datetime=1}\n')
  })

  it('render and import agree on an annotated comment', () => {
    const source = 'a{#c#}{.k author=Ann datetime=2026-11-21} b\n'
    expect(fromHtml(render(source)).source).toBe(source)
  })
})

describe('carve#6788: a ranged comment is read as a point (C2-M-113)', () => {
  it('finds its end inside another element and reports the range once', () => {
    const { source, codes } = fromHtml(
      '<p>a <span class="comment-start" data-comment-id="1">n</span><em>b<span class="comment-end" data-comment-id="1"></span></em> c</p>')
    expect(source).toBe('a {#n#}/b/ c\n')
    expect(codes).toEqual(['import-structure-repaired'])
  })

  it('pairs each start with the first later end of its id', () => {
    const { source, codes } = fromHtml('<p><span class="comment-start" data-comment-id="1">n</span>'
      + '<span class="comment-start" data-comment-id="2">m</span>x<span class="comment-end" data-comment-id="2"></span>'
      + '<span class="comment-end" data-comment-id="1"></span>y</p>')
    expect(source).toBe('{#n#}{#m#}xy\n')
    expect(codes).toEqual(['import-structure-repaired', 'import-structure-repaired'])
  })

  it('an end of another id stays an ordinary span', () => {
    const { source, codes } = fromHtml(
      '<p><span class="comment-start" data-comment-id="1">n</span>x<span class="comment-end" data-comment-id="9">e</span></p>')
    expect(source).toBe('{#n#}x[e]{.comment-end data-comment-id=9}\n')
    expect(codes).toEqual([])
  })

  it('an end before the start is not its end', () => {
    const { source } = fromHtml(
      '<p><span class="comment-end" data-comment-id="1">e</span><span class="comment-start" data-comment-id="1">n</span></p>')
    expect(source).toBe('[e]{.comment-end data-comment-id=1}{#n#}\n')
  })

  it('an empty element between start and end loses nothing', () => {
    const { codes } = fromHtml('<p><span class="comment-start" data-comment-id="1">n</span><em></em>'
      + '<span class="comment-end" data-comment-id="1"></span>x</p>')
    expect(codes).toEqual([])
  })
})

describe('carve#6794: an empty list-table cell (C2-M-112)', () => {
  it('a cell whose only paragraph is empty holds an empty line comment', () => {
    const result = importDocument('<table><tr><td><p></p></td><td><ul><li>a</li></ul></td></tr></table>', { from: 'html', listTable: true })
    expect(result.source).toBe('::: list-table\n- - %%\n  - - a\n:::\n')
  })
})
