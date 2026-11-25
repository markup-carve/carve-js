import { describe, expect, it } from 'vitest'
import { parse, render } from '../src/index.ts'

const defs = '*[HTML]: Hyper Text\n\n'

describe('C2-I-035, C2-I-100: no term matches inside an attribute block that attaches to nothing', () => {
  it.each([
    ['x {HTML} y', '<p>x {HTML} y</p>'],
    ['x {.c HTML} y', '<p>x {.c HTML} y</p>'],
    ['x {HTML x=1} y', '<p>x {HTML x=1} y</p>'],
    ['x{HTML}y', '<p>x{HTML}y</p>'],
    ['x {HTML-} y', '<p>x {HTML-} y</p>'],
    ['HTML {HTML} HTML', '<p><abbr title="Hyper Text">HTML</abbr> {HTML} <abbr title="Hyper Text">HTML</abbr></p>'],
    ['*a {HTML} b*', '<p><strong>a {HTML} b</strong></p>'],
  ])('%s', (input, html) => {
    expect(render(defs + input + '\n').trim()).toBe(html)
  })

  it('keeps the line one text node', () => {
    const paragraph = parse(defs + 'x {HTML} y\n').children.find((node) => node.type === 'paragraph')
    const children = paragraph?.type === 'paragraph' ? paragraph.children : []
    expect(children.map((node) => [node.type, node.type === 'text' ? node.value : null])).toEqual([['text', 'x {HTML} y']])
  })

  it('in a cell joined from fragments', () => {
    expect(render(defs + '| a | x {HTML} HTML |\n')).toContain('<td>x {HTML} <abbr title="Hyper Text">HTML</abbr></td>')
  })

  it.each([
    ['x {HTML y', '<p>x {<abbr title="Hyper Text">HTML</abbr> y</p>'],
    ['x {_HTML} y', '<p>x {_<abbr title="Hyper Text">HTML</abbr>} y</p>'],
    ['x {*HTML} y', '<p>x {*<abbr title="Hyper Text">HTML</abbr>} y</p>'],
  ])('C2-I-119: %s is no attribute block, so the term matches', (input, html) => {
    expect(render(defs + input + '\n').trim()).toBe(html)
  })
})
