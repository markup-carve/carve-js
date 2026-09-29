import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

const marks = [
  ['^', 'sup'], [',', 'sub'], ['=', 'mark'], ['/', 'em'],
  ['+', 'ins'], ['-', 'del'], ['*', 'strong'], ['_', 'u'], ['~', 's'],
] as const

describe('braced spans respect bracket runs', () => {
  it.each(marks)('%s stays literal across a closing bracket', (mark, tag) => {
    for (const source of [`[{${mark}a]${mark}}`, `[[{${mark}a]${mark}}]`]) {
      expect(carveToHtml(source)).toBe(`<p>${source}</p>`)
    }
    expect(carveToHtml(`[{${mark}a${mark}}]`)).toBe(`<p>[<${tag}>a</${tag}>]</p>`)
    expect(carveToHtml(`\\[{${mark}a]${mark}}`)).toBe(`<p>[<${tag}>a]</${tag}></p>`)
  })

  it.each(marks)('%s preserves balanced, unpaired and escaped brackets', (mark, tag) => {
    expect(carveToHtml(`{${mark}[a${mark}}`)).toBe(`<p><${tag}>[a</${tag}></p>`)
    expect(carveToHtml(`{${mark}[a]${mark}}`)).toBe(`<p><${tag}>[a]</${tag}></p>`)
    expect(carveToHtml(`{${mark}\\[a${mark}}]`)).toBe(`<p><${tag}>[a</${tag}>]</p>`)
  })
})

it.each([['+', 'ins'], ['-', 'del']])('critic %s closes before an outer bracket', (mark, tag) => {
  expect(carveToHtml(`{${mark}x[a${mark}}]`)).toBe(`<p><${tag}>x[a</${tag}>]</p>`)
})

describe('imported bracket spans beside reference links', () => {
  it('escapes the crossing opener exposed by a reference-link escape', () => {
    expect(htmlToCarve('<p><ins>[</ins>[a][a]</p>').value).toBe('{+\\[+}\\[a][a]\n')
  })

  it.each([
    '<p><ins>[</ins>{{ b.crv }}[a][a]</p>',
    '<p><ins>[</ins>[a][a]{{ b.crv }}</p>',
  ])('keeps bracket ranges beside an include directive: %s', (html) => {
    const source = htmlToCarve(html).value
    expect(carveToHtml(source)).toBe(html)
    expect(carveToCarve(source)).toBe(source)
  })

  it.each(marks)('%s preserves HTML and formats to itself', (_mark, tag) => {
    for (const before of ['', '[', '[[', 'x[']) {
      for (const inside of ['[', '[a', 'a]', ']', '[a]', 'a']) {
        for (const after of ['[a][a]', '][a][a]']) {
          const html = `<p>${before}<${tag}>${inside}</${tag}>${after}</p>`
          const source = htmlToCarve(html).value
          expect(carveToHtml(source), html).toBe(html)
          let formatted = source
          for (let pass = 0; pass < 3; pass++) {
            formatted = carveToCarve(formatted)
            expect(formatted, html).toBe(source)
          }
        }
      }
    }
  })
})
