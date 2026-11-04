import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('quoted link definitions in footnote bodies', () => {
  for (const source of [
    '[^n]: a\n\n    > [r]: /x\n[x][r]\n',
    '[^n]: a\n    > [r]: /x\n[x][r]\n',
    '[^n]: a\n  > [r]: /x\n[x][r]\n',
  ]) {
    it(`registers the definition in ${JSON.stringify(source)}`, () => {
      expect(carveToHtml(source)).toContain('<a href="/x">x</a>')
    })
  }

  // A definition interrupts an open quote paragraph in a note as anywhere else (carve-js#3922 ruling).
  it('registers a definition below an open quote paragraph', () => {
    const html = carveToHtml('[^n]: a\n  > prose\n  > [r]: /x\n\n[x][r] [^n]\n')
    expect(html).toContain('<a href="/x">x</a>')
    expect(html).not.toContain('[r]: /x')
  })

  it('registers a definition below a marker-line quote paragraph', () => {
    for (const spacer of ['\n', '\n\n']) {
      const html = carveToHtml(`[r][] [^c]${spacer}[^c]: > para\n      > [r]: /u\n`)
      expect(html).toContain('<a href="/u">r</a>')
      expect(html).toContain('<blockquote><p>para</p></blockquote>')
    }
  })

  it('registers a definition below a marker-line term\'s description', () => {
    const html = carveToHtml('[r][] [^c]\n\n[^c]: :: t\n  : para\n    [r]: /u\n')
    expect(html).toContain('<a href="/u">r</a>')
    expect(html).toContain('<dd>para</dd>')
  })
})
