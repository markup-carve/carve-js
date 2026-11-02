import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The definition prepass must open the fence the block reader opens on a note's marker line.
describe('a fence on a note marker line holds its definition-shaped lines', () => {
  it.each([
    '[^1]: ```js\n  [r]: /url\n\n[r][]\n',
    '[^1]: ```js\n     [r]: /url\n[r][]\n',
    '[^1]: ~~~\n  [r]: /url\n\n[r][]\n',
    '[^1]: ```=html\n     [r]: /url\n[r][]\n',
    '> [^1]: ```\n>   [r]: /url\n\n[r][]\n',
    '[^1]: ```\n  ```\n  ~~~\n  [r]: /u\n  ~~~\n\n[^1] [r][]\n',
  ])('%j', (source) => {
    expect(carveToHtml(source)).not.toContain('href="/u')
  })

  it.each([
    'para\n- [^1]: ```\n- [r]: /u\n\n[r][]\n',
    '[^1]: ```\n```\n[r]: /u\n```\n\n[r][]\n',
  ])('reads a fence that is no note fence: %j', (source) => {
    expect(carveToHtml(source)).toContain('<p>[r][]</p>')
  })

  it.each([
    '[^1]: ```js\n[r]: /url\n[r][]\n',
    '[^1]: ```js\n  x\n  ```\n[r]: /url\n\n[r][]\n',
  ])('registers a definition the fence no longer holds: %j', (source) => {
    expect(carveToHtml(source)).toContain('<a href="/url">r</a>')
  })
})
