import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a later note body after an earlier note attaches past its definition (carve#5447)', () => {
  const html = carveToHtml('[^a]: +\n[^b]: +\npara\n\n  own\n\n[^a] [^b]\n')
  expect(html).toContain('<li id="fn1">\n      <p>para<a href="#fnref1"')
  expect(html).toContain('<li id="fn2">\n      <p>own<a href="#fnref2"')
})

it('keeps paragraph and block continuations in the passed note', () => {
  const html = carveToHtml('[^a]: +\n[^b]: +\npara\n\n  own\nlazy\n\n  # headed\n\n[^a] [^b]\n')
  expect(html).toContain('<li id="fn1">\n      <p>para<a href="#fnref1"')
  expect(html).toContain('<li id="fn2">\n      <p>own\nlazy</p>\n      <h1 id="headed">headed</h1>')
})

it('keeps blank-separated paragraphs in the passed note', () => {
  const html = carveToHtml('[^a]: +\n[^b]: +\npara\n\n  own\n\n  second\n\n[^a] [^b]\n')
  expect(html).toContain('<li id="fn2">\n      <p>own</p>\n      <p>second<a href="#fnref2"')
})

it('does not replace the winning earlier definition of the passed label', () => {
  const html = carveToHtml('[^b]: x\n[^a]: +\n[^b]: +\npara\n\n  own\n\n[^a] [^b]\n')
  expect(html).toContain('<li id="fn2">\n      <p>x<a href="#fnref2"')
})
