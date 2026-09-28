import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('nested note bodies do not loosen their host item', () => {
  it.each(['    prose', '    > quote', '     > quote', '    # heading'])('keeps %s inside the note', body => {
    const html = carveToHtml(`- r[^n]\n\n  [^n]: note\n${body}\n`)
    const [list] = html.split('<section role="doc-endnotes"')
    expect(list).toContain('<li>r')
    expect(list).not.toContain('<li><p>')
  })

  it('still loosens for a later paragraph outside the note', () => {
    const html = carveToHtml('- r[^n]\n\n  [^n]: note\n    body\n\n  later\n')
    const [list] = html.split('<section role="doc-endnotes"')
    expect(list).toContain('<li><p>r')
    expect(list).toContain('<p>later</p>')
  })

  it('does not treat a link definition as a note body', () => {
    expect(carveToHtml('- r\n  [ref]: /url\n\n    later\n')).toContain('<li><p>r')
  })
})
