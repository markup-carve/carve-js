import { expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

it('maps integral CSS pixel dimensions on images to representable attributes', () => {
  for (const html of [
    '<img src="x" alt="x" style="width:20px;height:30px">',
    '<img style="height:30px;width:20px" src="x" alt="x">',
    '<img src="x" alt="x" width="10" height="11" style="width:20px;height:30px">',
    '<img style="width:20px;height:30px" width="10" height="11" src="x" alt="x">',
    '<img src="x" alt="x" style="width:020.0px;height:+30px">',
  ]) {
    const result = htmlToCarve(html)
    expect(result.value).toContain('width=20')
    expect(result.value).toContain('height=30')
    expect(carveToHtml(result.value)).toContain('width="20"')
    expect(carveToHtml(result.value)).toContain('height="30"')
  }
  expect(htmlToCarve('<img src="x" alt="x" style="width:0;height:5px">').value)
    .toBe('![x](x){width=0 height=5}\n')
  expect(htmlToCarve('<img src="x" alt="x" style="width:50%;height:auto">').report.diagnostics.map(d => d.code))
    .toEqual(['style-unmapped', 'style-unmapped'])
})
