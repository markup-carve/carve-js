import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'

const BACK = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'

describe('carve#6699: an inline footnote of comments and line breaks alone', () => {
  it.each([
    ['^[\n%% c\n](u) z\n'],
    ['^[\n%% c\n] z\n'],
    ['^[\n%% a\n%% b\n] z\n'],
    ['^[\n{%%}\n] z\n'],
    ['^[\\\n%% c\n] z\n'],
  ])('C2-H-019, C2-H-090, C2-H-091: %j writes only the backlink paragraph', (source) => {
    expect(render(source)).toContain(`<li id="fn1">\n      <p>${BACK}</p>\n    </li>`)
  })

  it('C2-H-019: text beside the comment line still writes the note paragraph', () => {
    const html = render('^[\n%% c\na] z\n')
    expect(html).toContain(`a${BACK}</p>`)
    expect(html).not.toContain(`<p>${BACK}`)
  })
})
