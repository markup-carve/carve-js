import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const note = (body: string) => `<p>${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>`

describe('a caption past a note in a quote folds into the note (CARVE-P2-008)', () => {
  it.each([
    '> [^a]: x\n^ cap\n\ny[^a]\n',
    '> > [^a]: x\n^ cap\n\ny[^a]\n',
    '> - [^a]: x\n^ cap\n\ny[^a]\n',
    '> [^a]: x\n>     more\n^ cap\n\ny[^a]\n',
  ])('keeps the caption line in the note body: %j', (input) => {
    const html = carveToHtml(input)
    expect(html).not.toContain('<figcaption>')
    expect(html).toContain('^ cap')
    expect(html).not.toContain('<p>^ cap</p>')
  })

  it('renders the pack case', () => {
    expect(carveToHtml('See [^a].\n \n\n> [^a]: note body\n^ cap\n')).toContain(note('note body\n^ cap'))
  })

  it('still captions a quote whose note has ended', () => {
    expect(carveToHtml('> [^a]: x\n> > q\n^ cap\n\ny[^a]\n')).toContain('<figcaption>cap</figcaption>')
    expect(carveToHtml('> para\n^ cap\n')).toContain('<figcaption>cap</figcaption>')
  })
})
