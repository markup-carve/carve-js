import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Expected HTML checked against the spec oracle at 223dc952 (carve-js#2237).
describe('a comment payload below a description column', () => {
  for (const base of [3, 5]) {
    for (const below of [0, 1, 2]) {
      for (const closer of [0, 3, 5]) {
        it(`keeps the span with opener ${base}, payload ${below}, closer ${closer}`, () => {
          const source = ':: term\n:  desc\n\n' +
            ' '.repeat(base) + '%%%\n' +
            ' '.repeat(base) + 'p\n' +
            ' '.repeat(below) + 'z\n' +
            ' '.repeat(closer) + '%%%\n   \n   tail\n'
          expect(carveToHtml(source)).toBe(
            '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>desc</p>\n    <p>tail</p>\n  </dd>\n</dl>',
          )
        })
      }
    }
  }

  for (const closer of [0, 1, 2]) {
    for (const payload of ['', '   p\n']) {
      for (const follower of ['z', ' z', '  z']) {
        it(`ends the body after closer ${closer}, payload ${JSON.stringify(payload)}, follower ${JSON.stringify(follower)}`, () => {
          const source = ':: t\n:  d\n\n   %%%\n' + payload +
            ' '.repeat(closer) + '%%%\n' + follower + '\n'
          expect(carveToHtml(source)).toBe(
            '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<p>z</p>',
          )
        })
      }
    }
  }

  it('folds plain text after an unterminated comment opener', () => {
    expect(carveToHtml(':: t\n:  d\n\n   %%%\n   p\nz\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <p>p\nz</p>\n  </dd>\n</dl>',
    )
  })

  it.each([
    ['an opener with no paragraph below it', '   %%%\nz\n   %%%\n'],
    ['a closed span', '   %%%\n   p\n   %%%\nz\n'],
  ])('ends the body after %s', (_name, body) => {
    expect(carveToHtml(':: t\n:  d\n\n' + body)).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<p>z</p>',
    )
  })

  it('ends the body when the unfinished span ends on a heading', () => {
    expect(carveToHtml(':: t\n:  d\n\n   %%%\n   # h\nz\n   %%%\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>d</p>\n    <h1 id="h">h</h1>\n  </dd>\n</dl>\n<p>z</p>',
    )
  })

  it('keeps the list-item boundary at a below-column payload line', () => {
    expect(carveToHtml('- d\n\n  %%%\n  p\nz\n  %%%\n')).toBe(
      '<ul>\n  <li>d\n    p\n  </li>\n</ul>\n<p>z</p>',
    )
  })

  it('keeps folding a marker below a raised colon-container base', () => {
    expect(carveToHtml('- head\n\n      :::\n      a\n  - second\n')).toBe(
      '<ul>\n  <li>head\n    <div>\n      <p>a\n- second</p>\n    </div>\n  </li>\n</ul>',
    )
  })
})
