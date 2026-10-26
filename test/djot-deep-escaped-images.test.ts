import { imageParagraphsAsImages } from './legacy-image-paragraph.js'
import { expect, test } from 'vitest'
import { carveToHtml, djotToCarve, normalizeHtml } from '../src/index.js'
import controls from './fixtures/djot-deep-escaped-images.json'

test('nested escaped image labels preserve Native output and opaque syntax', () => {
  for (const { source, html } of controls) {
    const actual = carveToHtml(djotToCarve(source)).replace(/ role="math"/g, '')
    expect(normalizeHtml(actual).html, source).toBe(normalizeHtml(imageParagraphsAsImages(html)).html)
  }
})

test.each([128, 512, 1600, 6400])('escaped bracket labels remain stack safe at depth %i', depth => {
  for (const leaf of ['x\\[b\\]', '\\[x\\]', 'x\\\\y', 'x\\q', '\\]x\\[']) {
    const source = '!['.repeat(depth) + leaf + '](u)'.repeat(depth)
    expect(carveToHtml(djotToCarve(source)), leaf).toBe(carveToHtml(djotToCarve(`![${leaf}](u)`)))
  }
})
