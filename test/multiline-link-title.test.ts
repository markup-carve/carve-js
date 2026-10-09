import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve, parse } from '../src/index.js'

describe('literal backslashes before wrapped title lines', () => {
  for (const marker of ['', '!']) {
    for (const quote of ['"', "'"]) {
      for (const slashes of [1, 2, 3]) {
        const title = 't' + '\\'.repeat(slashes) + '\nu'
        const source = `See ${marker}[a](/u ${quote}${title}${quote})\n`
        it(`${marker || 'link'} ${quote} with ${slashes} backslashes`, () => {
          const once = carveToCarve(source)
          expect(carveToCarve(once)).toBe(once)
          expect(carveToHtml(once)).toBe(carveToHtml(source))
          const document = parse(source)
          const paragraph = document.children[0]
          expect(paragraph?.type).toBe('paragraph')
          if (paragraph?.type !== 'paragraph') throw new Error('paragraph')
          const node = paragraph.children[1]
          expect(node?.type).toBe(marker ? 'image' : 'link')
          if (node?.type !== 'image' && node?.type !== 'link') throw new Error('titled node')
          expect(node.title).toBe('t' + '\\'.repeat(Math.ceil(slashes / 2)) + '\nu')
        })
      }
    }
  }
  for (const source of [
    '> See [a](/u "t\\\nu")\n',
    '- See [a](/u "t\\\n  u")\n',
    'See [a](/u "t\\\r\nu")\r\n',
  ]) {
    it(`reads a wrapped title in its container ${JSON.stringify(source)}`, () => {
      const once = carveToCarve(source)
      expect(carveToHtml(source)).toContain('<a ')
      expect(carveToHtml(once)).toBe(carveToHtml(source))
      expect(carveToCarve(once)).toBe(once)
    })
  }
  it('a title hides emphasis delimiters across its wrapped line', () => {
    expect(carveToHtml('*x [a](/u "t\\\n*u") y*\n')).toContain('<strong>x <a ')
    expect(carveToHtml('*x [a](/u "t\\\n*u") y*\n')).toContain(' y</strong>')
  })
  it('a reference-definition title stays on one line', () => {
    expect(carveToHtml('[r]: /u "t\\\nu"\n\nSee [r][].\n')).not.toContain('<a ')
  })
  it('text and a hard break that resemble a title stay text after import', () => {
    const source = htmlToCarve('<p>[a](/u "t<br>u")</p>').value
    expect(carveToHtml(source)).not.toContain('<a ')
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })
  for (const separator of ['\u2028', '\u2029']) {
    it(`keeps an image caption after ${JSON.stringify(separator)}`, () => {
      const source = `![a](/u "t\\${separator}u")\n^ caption\n`
      expect(carveToHtml(source)).toContain('<figure>')
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    })
    it(`reads a reference title with ${JSON.stringify(separator)}`, () => {
      const source = `[r]: /u "t\\${separator}u"\n\nSee [r][].\n`
      expect(carveToHtml(source)).toContain('<a ')
    })
  }
  it('an unclosed quoted title remains text', () => {
    expect(carveToHtml('[a](/u "t\\\nu)\n')).not.toContain('<a ')
  })
  it('a blank line ends the block before the title closes', () => {
    expect(carveToHtml('[a](/u "t\\\n\nu")\n')).not.toContain('<a ')
  })
})
