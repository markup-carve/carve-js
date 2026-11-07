import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('lets the earliest quoted note marker claim the following paragraph', () => {
  const html = carveToHtml('- > [^a]: +\n  > [^b]: +\n  > para\n\n[^a] [^b]\n')
  expect(html).toContain('<li id="fn1">\n      <p>para')
  expect(html).toContain('<li id="fn2">\n      <p><a')
  expect(html).not.toContain('<p>&gt; para</p>')
})

it('ends that claimed paragraph before the next block', () => {
  const html = carveToHtml('[^a]: +\n[^b]: +\npara\n# heading\n\n[^a] [^b]\n')
  expect(html).toContain('<li id="fn1">\n      <p>para<a')
  expect(html).toContain('<section id="heading">\n  <h1>heading</h1>')
  expect(html).not.toContain('<li id="fn1">\n      <p>para</p>\n      <h1')
})

it('keeps verse indentation after a quote prefix', () => {
  expect(carveToHtml('> - +\n> ::: |\n>   a\n')).toBe(`<blockquote>
  <ul>
    <li>
      <div class="line-block">
        <p>&nbsp;&nbsp;a</p>
      </div>
    </li>
  </ul>
</blockquote>`)
})
