import { describe, expect, it } from 'vitest'
import { importDocument } from '../public/formats.ts'

const START = '<span class="comment-start" data-comment-id="1">n</span>'
const END = '<span class="comment-end" data-comment-id="1"></span>'
const LOST = 'Ranged comment read as a point: its range is lost'

function fromHtml(html: string): { source: string, messages: string[] } {
  const result = importDocument(html, { from: 'html' })
  return { source: result.source, messages: result.diagnostics.map((item) => item.message) }
}

describe('carve#6834: only a kept node stands in a ranged comment range (C2-M-113, C2-M-069)', () => {
  it.each([
    ['<em title="x"></em>', '{#n#}y\n'],
    ['<strong class="c"></strong>', '{#n#}y\n'],
    ['<mark lang="de"></mark>', '{#n#}y\n'],
    ['<span onclick="x"></span>', '{#n#}y\n'],
    ['<bdi></bdi>', '{#n#}y\n'],
    ['<small></small>', '{#n#}y\n'],
    ['<b><em title="x"></em></b>', '{#n#}y\n'],
    ['<i><span onclick="x"></span><bdi></bdi></i>', '{#n#}y\n'],
  ])('a dropped %s loses no range', (middle, source) => {
    const result = fromHtml(`<p>${START}${middle}${END}y</p>`)
    expect(result.source).toBe(source)
    expect(result.messages).not.toContain(LOST)
  })

  it.each([
    ['<a id="u"></a>', '{#n#}[]{#u}y\n'],
    ['<span title="k"></span>', '{#n#}[]{title=k}y\n'],
    ['<span title="k"><em title="x"></em></span>', '{#n#}[]{title=k}y\n'],
    ['<span style="color:red" onclick="x"></span>', '{#n#}[]{style=color:red}y\n'],
    ['<cite title="x"></cite>', '{#n#}[]{title=x}y\n'],
    ['<sup class="footnote-ref"><a href="#fn1"></a></sup>', '{#n#}[^1]y\n'],
  ])('a kept %s loses the range', (middle, source) => {
    const result = fromHtml(`<p>${START}${middle}${END}y</p>`)
    expect(result.source).toBe(source)
    expect(result.messages).toContain(LOST)
  })

  it('a dropped element at either end of a range with text in it still loses the range', () => {
    expect(fromHtml(`<p>${START}<em title="x"></em>a${END}y</p>`).messages).toContain(LOST)
    expect(fromHtml(`<p>${START}a<span onclick="x"></span>${END}y</p>`).messages).toContain(LOST)
  })

  it('a dropped element inside a kept inline counts as nothing, its text does', () => {
    expect(fromHtml(`<p>x<em>${START}<bdi></bdi>${END}</em>y</p>`).messages).not.toContain(LOST)
    expect(fromHtml(`<p>${START}<em>a<bdi></bdi></em>${END}y</p>`).messages).toContain(LOST)
  })

  it('a raw carrier the reader drops with its content counts as nothing', () => {
    const html = `<p>${START}<span data-carve-raw="html"><em></em></span>${END}y</p>`
    expect(importDocument(html, { from: 'html', rawHtml: true }).diagnostics.map((item) => item.message)).not.toContain(LOST)
  })

  it('an element around the end of the range is no inline in it', () => {
    expect(fromHtml(`<p>${START}<span title="k">${END}</span>y</p>`).messages).not.toContain(LOST)
  })

  it('an empty reference to an inline footnote with a ranged comment in it is read once', () => {
    const note = '<section role="doc-endnotes"><ol><li id="fn1" data-carve-inline-footnote><p>b '
      + '<span class="comment-start" data-comment-id="2">m</span>c<span class="comment-end" data-comment-id="2"></span></p></li></ol></section>'
    const result = fromHtml(`<p>${START}<a role="doc-noteref" href="#fn1"></a>${END}y</p>${note}`)
    expect(result.source).toBe('{#n#}^[b {#m#}c]y\n')
    expect(result.messages.filter((message) => message === LOST)).toHaveLength(2)
  })
})
