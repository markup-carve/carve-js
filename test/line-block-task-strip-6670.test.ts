import { describe, expect, it } from 'vitest'
import { render } from '../public/index.ts'

describe('a line block behind a task box (carve#6670)', () => {
  it('C2-B-027, C2-B-130: the line is stripped by the task mark column only', () => {
    expect(render('- [ ] ::: |\n      a\n  :::\n')).toBe([
      '<ul class="task-list">',
      '  <li class="task" style="list-style: none"><input type="checkbox" disabled> ',
      '    <div class="line-block">',
      '      <p>&nbsp;&nbsp;&nbsp;&nbsp;a</p>',
      '    </div>',
      '  </li>',
      '</ul>',
    ].join('\n'))
  })

  it.each([
    ['- [x] ::: |\n     a\n  :::\n', '&nbsp;&nbsp;&nbsp;a'],
    ['1. [ ] ::: |\n       a\n   :::\n', '&nbsp;&nbsp;&nbsp;&nbsp;a'],
    ['- [ ] ::: note\n      ::: |\n      a\n      :::\n  :::\n', '&nbsp;&nbsp;&nbsp;&nbsp;a'],
    ['- [ ] text\n\n      ::: |\n      a\n      :::\n', '&nbsp;&nbsp;&nbsp;&nbsp;a'],
  ])('C2-B-027: a task box does not move the content column in %j', (input, line) => {
    expect(render(input)).toContain(`<p>${line}</p>`)
  })

  it('C2-B-029: a fence behind a task box still strips to its opener', () => {
    expect(render('- [ ] ```\n      x\n  ```\n')).toContain('<pre><code>x\n</code></pre>')
  })
})
