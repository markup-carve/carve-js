import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

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
  it('an unclosed quoted title remains text', () => {
    expect(carveToHtml('[a](/u "t\\\nu)\n')).not.toContain('<a ')
  })
  it('a blank line ends the block before the title closes', () => {
    expect(carveToHtml('[a](/u "t\\\n\nu")\n')).not.toContain('<a ')
  })
})
