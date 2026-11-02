import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (source: string) => carveToHtml(source).replace(/\n\s*/g, '')

// §17 L1c with L1b and CARVE-P9-013 property 3: each document renders as with its invisible lines removed.
describe('a blank before only invisible lines in a sub-item body loosens the list (markup-carve/carve#4903)', () => {
  it.each([
    '- a\n  - b\n\n    [r]: /u\n- sub\n',
    '- a\n  - b\n\n    *[A]: x\n- sub\n',
    '- a\n  1. b\n\n     [r]: /u\n- sub\n',
    '- a\n  - b\n    - c\n\n      [r]: /u\n- sub\n',
    '- a\n  - b\n\n    %% c\n    [r]: /u\n- sub\n',
    '> - a\n>   - b\n>\n>     [r]: /u\n> - sub\n',
    '1. a\n   - b\n\n     %% c\n2. sub\n',
  ])('%j', (source) => {
    expect(flat(source)).toContain('<li><p>sub</p></li>')
  })

  it.each([
    '- a\n  - b\n\n    [r]: /u\n    more\n- sub\n',
    '- a\n  - b\n\n    %% c\n    more\n- sub\n',
  ])('stays tight when a visible line follows: %j', (source) => {
    expect(flat(source)).toContain('<li>sub</li>')
  })

  it.each([
    '- a\n  - ```\n    x\n\n    [r]: /u\n- sub\n',
    '- a\n  - ~~~\n    x\n\n    %% c\n- sub\n',
    '- a\n  - b\n\n    ```\n    x\n\n    *[A]: y\n- sub\n',
    '- ```\n  x\n\n  [r]: /u\n- sub\n',
  ])('stays tight when an open fence holds the lines after the blank: %j', (source) => {
    expect(flat(source)).toContain('<li>sub</li>')
  })

  it('loosens when a line below the fence column ends the fence', () => {
    expect(flat('- a\n  - ```\n    x\n\n   %% c\n- sub\n')).toContain('<li><p>sub</p></li>')
  })
})
