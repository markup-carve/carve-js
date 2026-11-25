import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'

describe('carve#6609: an authored id inside a footnote definition that is not written', () => {
  it('C2-H-024: the id is reserved, so a heading of the same slug takes the suffix', () => {
    expect(render('[^f]: [s]{#i}\n\n### i\n')).toBe('<section id="i-2">\n  <h3>i</h3>\n</section>')
    expect(render('### i\n\n[^f]: a [b]{#i} c\n')).toBe('<section id="i-2">\n  <h3>i</h3>\n</section>')
  })

  it('C2-H-024: the same as with a reference to the note', () => {
    expect(render('[^f]: [s]{#i}\n\n### i\n\n[^f]\n')).toContain('<section id="i-2">')
  })

  it('C2-H-202: a note id avoids it as well', () => {
    expect(render('[^f]: [s]{#fn1}\n\n^[a]\n')).toContain('<li id="fn1-2">')
  })
})
