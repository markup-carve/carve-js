import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\s*\n\s*/g, ' ').replace(/> /g, '>').replace(/ </g, '<')

// CARVE-P9-016 with PART 0 [B-div-end]: only a run of the opener's own width closes the div.
describe('a bare colon run of another width stays in the paragraph', () => {
  it.each([
    ['- a\n  ::::\n  :::bad\n  :::\nT\n', '<ul><li>a<div><p>:::bad ::: T</p></div></li></ul>'],
    ['- a\n    ::::\n    :::bad\n    :::\nT\n', '<ul><li>a<div><p>:::bad ::: T</p></div></li></ul>'],
    ['- a\n  :::\n  :::bad\n  :::\nT\n', '<ul><li>a<div><p>:::bad</p></div></li></ul><p>T</p>'],
    ['- a\n  ::::\n  bad\n  :::\nT\n', '<ul><li>a<div><p>bad</p><div></div></div></li></ul><p>T</p>'],
    ['- a\n  ::::\n  :::bad\n  ::::\nT\n', '<ul><li>a<div><p>:::bad</p></div></li></ul><p>T</p>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))
})
