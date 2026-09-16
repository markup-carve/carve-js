import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve, renderCarve, renderHtml, SourceUnspellableError, type Document } from '../src/index.js'

// PART 9 §9 E3 keeps a second braced opener of one kind literal, so a braced
// span directly inside a braced span of the same kind has no spelling. The
// writer refuses the tree; the HTML importer unwraps the inner level and
// reports it (markup-carve/carve#2066).

const rows: Array<[string, string, string]> = [
  ['a strong ending in a break', '<p>a<strong><b>x<br></b></strong>b</p>', 'a{*x\\\n*}b\n'],
  ['a strong with text after the inner one', '<p>a<strong><b>x<br></b>y</strong>b</p>', 'a{*x\\\ny*}b\n'],
  ['an emphasis ending in a break', '<p>a<em><i>x<br></i></em>b</p>', 'a{/x\\\n/}b\n'],
  ['a superscript', '<p><sup><sup>x</sup></sup></p>', '{^x^}\n'],
  ['an insertion', '<p><ins><ins>x</ins></ins></p>', '{+x+}\n'],
  ['a deletion', '<p><del><del>x</del></del></p>', '{-x-}\n'],
]

describe('a braced span directly inside a braced span of the same kind', () => {
  it.each(rows)('is refused by the writer for %s', (_, html) => {
    expect(() => renderCarve(htmlToAst(html).value)).toThrow(SourceUnspellableError)
  })

  it.each(rows)('is unwrapped and reported by the importer for %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(['structure-unspellable'])
    expect(carveToCarve(result.value)).toBe(result.value)
  })

  it('unwraps every level of a triple nesting', () => {
    const result = htmlToCarve('<p><sub><sub><sub>x</sub></sub></sub></p>')
    expect(result.value).toBe('{,x,}\n')
    expect(result.report.diagnostics.map((d) => d.path)).toEqual(['/p[1]/sub[1]/sub[1]', '/p[1]/sub[1]/sub[1]/sub[1]'])
  })

  it('names the element that was unwrapped, not an unwrapped wrapper around it', () => {
    const result = htmlToCarve('<p><span><sup><sup>x</sup></sup></span></p>')
    expect(result.value).toBe('{^x^}\n')
    const unspellable = result.report.diagnostics.filter((d) => d.code === 'structure-unspellable')
    expect(unspellable.map((d) => d.path)).toEqual(['/p[1]/span[1]/sup[1]/sup[1]'])
  })

  it('decides from the tree as it is now, not as an earlier render saw it', () => {
    const tree = htmlToAst('<p><strong><b>x<br></b></strong></p>').value
    expect(renderCarve(tree)).toBe('*{*x\\\n*}*\n')
    const paragraph = tree.children[0] as { children: Array<{ children: Array<{ children: unknown[] }> }> }
    paragraph.children[0]!.children[0]!.children.pop()
    paragraph.children.unshift({ type: 'text', value: 'a' } as never)
    expect(renderCarve(tree)).toBe('a{**x**}\n')
  })

  it('reports the attributes the unwrapped level carried', () => {
    const result = htmlToCarve('<p><sup class="a"><sup class="b">x</sup></sup></p>')
    expect(result.value).toBe('{^x^}{.a}\n')
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(['structure-unspellable', 'attribute-dropped'])
  })
})

describe('a same-kind nesting one level can spell bare', () => {
  it.each([
    ['a bare inner strong', '<p>a<strong><b>x</b></strong>b</p>', 'a{**x**}b\n'],
    ['a bare outer strong', '<p><strong><b>x<br></b></strong></p>', '*{*x\\\n*}*\n'],
    ['two kinds, both braced', '<p>a<s><del>x</del></s>b</p>', 'a{~{-x-}~}b\n'],
  ])('is written and reads back for %s', (_, html, carve) => {
    const tree: Document = htmlToAst(html).value
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics).toEqual([])
    expect(carveToHtml(result.value)).toBe(renderHtml(tree))
  })
})
