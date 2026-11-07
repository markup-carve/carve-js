import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('gives the first visible follower to the earlier footnote plus', () => {
  const html = carveToHtml('[^a]: +\n[^a]: +\n- b\n\n[^a]\n')
  expect(html).toContain('<li id="fn1">\n      <ul>\n        <li>b</li>')
})

it('keeps the same owner inside a quote', () => {
  const html = carveToHtml('> [^a]: +\n> [^a]: +\n> - b\n\n> [^a]\n')
  expect(html).toContain('<blockquote>\n\n</blockquote>')
  expect(html).toContain('<li id="fn1">\n      <ul>\n        <li>b</li>')
})

it('keeps a distinct skipped note registered', () => {
  const html = carveToHtml('[^a]: +\n[^b]: +\n- b\n\n[^a] [^b]\n')
  expect(html).toContain('<li id="fn1">\n      <ul>\n        <li>b</li>')
  expect(html).toContain('<li id="fn2">\n      <p><a href="#fnref2"')
})

it('leaves visible text after a skipped note in the document', () => {
  const html = carveToHtml('[^a]: +\n[^a]: +\npara\n\n[^a]\n')
  expect(html).toMatch(/^<p>para<\/p>/)
})
