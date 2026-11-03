import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A sibling marker after a comment at the nested item's content column opens a paragraph like any marker line,
// so a following unmarked line is its lazy text (PART 0 lazy continuation; spec model at carve main).
describe('a sibling marker after a comment keeps its paragraph open', () => {
  it.each([
    ['- a', '  - inner', '    %% c', '  - x', 'tail'],
    ['- a', '  - inner', '    %% c', '   - x', 'tail'],
    ['- a', '  - inner', '    %%', '  - x', 'tail'],
    ['1. a', '   1. inner', '      %% c', '    1. x', 'tail'],
  ])('folds the line after %s / %s / %s / %s into the sibling', (...lines) => {
    expect(carveToHtml(lines.join('\n'))).toContain('<li>x\ntail</li>')
    expect(carveToHtml(lines.join('\n'))).not.toContain('<p>tail</p>')
  })

  it('reads the same in a note body', () => {
    const html = carveToHtml(['[^n]: a', '  1. inner', '    %% c', '  1. x', 'tail', '', 'see[^n]'].join('\n'))
    expect(html).toContain('<li>x\ntail</li>')
  })

  it('still ends the sibling at a block opener', () => {
    const html = carveToHtml(['- a', '  - inner', '    %% c', '  - x', '> q'].join('\n'))
    expect(html).toContain('<li>x</li>')
    expect(html).toContain('</ul>\n<blockquote>')
  })
})
