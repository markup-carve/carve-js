import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const twoDescriptions = '<dl>\n  <dt>t</dt>\n  <dd>a</dd>\n  <dd>b</dd>\n</dl>'

describe('a description is a sibling at any column its owner holds the list (CARVE-P0-024 S3)', () => {
  it.each([
    ['indented list', ' :: t\n : a\n : b\n'],
    ['one column right', ':: t\n: a\n : b\n'],
    ['one column left of an indented list', ' :: t\n : a\n: b\n'],
    ['wider separator', ':: t\n:  a\n :  b\n'],
  ])('reads two descriptions: %s', (_name, source) => {
    expect(carveToHtml(source)).toBe(twoDescriptions)
  })

  it('reads a second term past the first without moving the next description', () => {
    expect(carveToHtml(':: t\n :: u\n: d\n : e\n'))
      .toBe('<dl>\n  <dt>t</dt>\n  <dt>u</dt>\n  <dd>d</dd>\n  <dd>e</dd>\n</dl>')
  })

  it('measures a shifted description body from its own marker', () => {
    expect(carveToHtml(':: a\n  : c\n: b\n  # H\n'))
      .toBe('<dl>\n  <dt>a</dt>\n  <dd>c</dd>\n  <dd>\n    <p>b</p>\n    <h1 id="H">H</h1>\n  </dd>\n</dl>')
  })

  it('reads a second description after a task item marker-line term', () => {
    expect(carveToHtml('- [ ] :: t\n      : a\n      : b\n')).toBe(
      '<ul class="task-list">\n  <li><input type="checkbox" disabled> \n    <dl>\n      <dt>t</dt>\n      <dd>a</dd>\n      <dd>b</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('keeps a line at the body column in that body', () => {
    expect(carveToHtml(':: t\n: a\n  : b\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>a\n: b</dd>\n</dl>')
  })

  it('folds a line whose owner holds no open description', () => {
    expect(carveToHtml('- item\n  :: t\n  : a\n : b\n'))
      .toBe('<ul>\n  <li>item\n    <dl>\n      <dt>t</dt>\n      <dd>a\n: b</dd>\n    </dl>\n  </li>\n</ul>')
  })
})
