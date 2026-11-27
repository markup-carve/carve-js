import { describe, expect, it } from 'vitest'
import { importDocument } from '../public/formats.ts'

const start = '<span class="comment-start" data-comment-id="1">n</span>'
const end = '<span class="comment-end" data-comment-id="1"></span>'

function read(html: string): { source: string, codes: string[] } {
  const result = importDocument(html, { from: 'html' })
  return { source: result.source, codes: result.diagnostics.map(item => item.code) }
}

describe('HTML ranged comment prewalk follows the reader', () => {
  it('C2-M-069: a whole-value code with an empty child leaves no range', () => {
    expect(read(`<p>${start}<code><abbr id="i"></abbr></code>${end}y</p>`)).toEqual({ source: '{#n#}y\n', codes: [] })
  })

  it('C2-H-186: a rejected block-slot carrier cannot claim an inline ordinal', () => {
    const html = '<p data-carve-snippet="1:inline:$bad">a</p>'
      + `<p>${start}<script data-carve-snippet="1:inline:$good">x</script>${end}y</p>`
    expect(read(html)).toEqual({ source: 'a\n\n{#n#}{{ $good }}y\n',
      codes: ['import-carrier-ignored', 'import-structure-repaired'] })
  })

  it('C2-M-045: a carrier inside code is text, not a use', () => {
    const html = `<p>${start}<code><span data-carve-snippet="1:inline:$bad">x</span></code>`
      + `<script data-carve-snippet="1:inline:$good">z</script>${end}y</p>`
    expect(read(html)).toEqual({ source: '{#n#}`x`{{ $good }}y\n', codes: ['import-structure-repaired'] })
  })
})
