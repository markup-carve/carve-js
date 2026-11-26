// Three defects of the engine against its own specification, found by the 0.1/0.2 parity run.
import { describe, expect, it } from 'vitest'
import { format, render } from '../src/index.ts'

describe('parity defects', () => {
  it('C2-B-083: a tab after the space behind the colon starts no destination, so the line is text', () => {
    expect(render('[a]: \t/u\n\n[a][]\n')).toBe('<p>[a]: \t/u</p>\n<p>[a][]</p>')
    expect(render('[a]:\t/u\n')).toBe('<p>[a]:\t/u</p>')
    expect(render('[a]:  /u\n\n[a][]\n')).toBe('<p><a href="/u">a</a></p>')
  })

  it('C2-B-190, C2-B-024: two openers refused at the depth limit stay lazy lines of one paragraph', () => {
    const html = render(`${':::: note\n'.repeat(202)}x\n`)
    expect(html.split('<aside').length - 1).toBe(200)
    expect(html).toContain('<p>:::: note\n:::: note\nx</p>')
  })

  it('C2-B-125: past the depth limit a bare colon run still closes a div below the quotes it does not continue', () => {
    const html = render(`:::\n${'> '.repeat(199)}a\n:::\nb\n`)
    expect(html).toContain('<p>a</p>')
    expect(html.endsWith('</div>\n<p>b</p>')).toBe(true)
  })

  it('C2-W-075: a collapsed reference keeps a bracket its key holds bare when a soft break ends the content', () => {
    expect(format('[\\^[]\n][]', { normalize: true })).toBe('[\\^[]\n][]\n')
  })

  it('C2-H-091: a raw block that writes nothing is not the last rendered block of a note', () => {
    const html = render('x[^n]\n\n[^n]: a\n\n    ```=latex\n    x\n    ```\n')
    expect(html).toContain('<p>a<a href="#fnref1" role="doc-backlink"')
    expect(html).not.toContain('<p><a href="#fnref1"')
  })
})
