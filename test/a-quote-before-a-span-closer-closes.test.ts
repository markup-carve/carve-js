import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P3-023 R1: a span's closer is not the next character, so a quote after a dash closes there
// (ruling markup-carve/carve#4318). Expected HTML is the spec model's.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a quote before a span closer reads as at the end of the paragraph', () => {
  it.each([
    ['*"Wait-"*', '<p><strong>“Wait-”</strong></p>'],
    ['_"Wait-"_', '<p><u>“Wait-”</u></p>'],
    ['/"Wait-"/', '<p><em>“Wait-”</em></p>'],
    ['{+"Wait-"+}', '<p><ins>“Wait-”</ins></p>'],
    ['{-"Wait-"-}', '<p><del>“Wait-”</del></p>'],
    ['~"Wait-"~', '<p><s>“Wait-”</s></p>'],
    ["*'Wait-'*", '<p><strong>‘Wait-’</strong></p>'],
    ['["Wait-"]{.x}', '<p><span class="x">“Wait-”</span></p>'],
    ['"Wait-"', '<p>“Wait-”</p>'],
  ])('%s', (source, expected) => expect(html(source)).toBe(expected))
})
