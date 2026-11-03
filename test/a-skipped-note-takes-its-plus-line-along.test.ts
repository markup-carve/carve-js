import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.replace(/\s+/g, ' ').replace(/ ?(<[^>]+>) ?/g, '$1').trim()

const notes = (...bodies: string[]) => '<section role="doc-endnotes" aria-label="Footnotes"><hr><ol>' +
  bodies.map((body, k) => `<li id="fn${k + 1}">${body}<a href="#fnref${k + 1}" role="doc-backlink" aria-label="Back to reference">↩</a></p></li>`).join('') +
  '</ol></section>'
const refs = '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a> <a id="fnref2" href="#fn2" role="doc-noteref"><sup>2</sup></a></p>'

// carve#5034: a note definition a `+` skips takes its whole body along, an indented `+` line included (CARVE-P9-067).
it('attaches the block after a skipped note whose body holds an indented plus line', () => {
  expect(normalize(carveToHtml('[^a]: +\n[^n]: a\n +\npara\n> q\n\nsee[^n] [^a]\n'))).toBe(normalize(
    refs + notes('<p>a + para', '<blockquote><p>q</p></blockquote><p>'),
  ))
})

it('attaches the block after a skipped note whose body holds an indented text line', () => {
  expect(normalize(carveToHtml('[^a]: +\n[^n]: a\n x\npara\n> q\n\nsee[^n] [^a]\n'))).toBe(normalize(
    refs + notes('<p>a x para', '<blockquote><p>q</p></blockquote><p>'),
  ))
})

it('ends the skipped note at a comment line, which is skipped on its own', () => {
  expect(normalize(carveToHtml('[^a]: +\n[^n]: a\n%% c\npara\n\nsee[^n] [^a]\n'))).toBe(normalize(
    refs + notes('<p>a', '<p>para'),
  ))
})
