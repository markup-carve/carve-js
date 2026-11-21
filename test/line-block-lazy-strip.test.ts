import { describe, expect, it } from 'vitest'
import { render } from '../public/index.ts'

const nestedLineBlock = (lazy: string) => [
  '<ul>',
  '  <li>',
  '    <ul>',
  '      <li>',
  '        <div class="line-block">',
  `          <p>a<br>\n${lazy}b</p>`,
  '        </div>',
  '      </li>',
  '    </ul>',
  '  </li>',
  '</ul>',
].join('\n')

describe('lazy line of a line block', () => {
  it.each([' ', '  ', '   '])('C2-B-027, C2-B-130: the outer item strips the lazy line %j', (lead) => {
    expect(render(`- - ::: |\n    a\n${lead}b\n`)).toBe(nestedLineBlock(''))
  })

  it('C2-B-130: spaces past the content column of the owning item stay as content', () => {
    expect(render('- - ::: |\n    a\n      b\n')).toBe(nestedLineBlock('&nbsp;&nbsp;'))
  })

  it('C2-B-027: a lazy line owned by the outer item is stripped by its content column only', () => {
    expect(render('- > ::: |\n  > a\n   b\n')).toContain('<p>a<br>\n&nbsp;b</p>')
  })

  it('C2-B-130: a lazy line that no container owns keeps its spaces', () => {
    expect(render('> ::: |\n> a\n  b\n')).toContain('<p>a<br>\n&nbsp;&nbsp;b</p>')
  })
})
