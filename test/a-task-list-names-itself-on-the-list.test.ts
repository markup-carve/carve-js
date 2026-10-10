import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

const cycle = (source: string): string => carveToCarve(htmlToCarve(carveToHtml(source)).value)

describe('a task list names itself on the list, and a done item on the item', () => {
  it('puts task-list on the list and a lowercase x on every done item', () => {
    expect(carveToHtml('- [ ] open\n- [x] done\n- [X] shout\n- [-] dropped\n')).toBe(
      '<ul class="task-list">\n'
        + '  <li><input type="checkbox" disabled aria-label="open"> open</li>\n'
        + '  <li data-task-state="x"><input type="checkbox" checked disabled aria-label="done"> done</li>\n'
        + '  <li data-task-state="x"><input type="checkbox" checked disabled aria-label="shout"> shout</li>\n'
        + '  <li data-task-state="-"><input type="checkbox" disabled aria-label="dropped"> dropped</li>\n'
        + '</ul>',
    )
  })

  it('leads an authored class with the base class', () => {
    expect(carveToHtml('{.c}\n- [ ] a\n')).toContain('<ul class="task-list c">')
  })

  it('leaves a plain list nested in a task item bare', () => {
    expect(carveToHtml('- [x] parent\n  - child\n')).toBe(
      '<ul class="task-list">\n'
        + '  <li data-task-state="x"><input type="checkbox" checked disabled aria-label="parent"> parent\n'
        + '    <ul>\n      <li>child</li>\n    </ul>\n'
        + '  </li>\n</ul>',
    )
  })

  it('leaves a plain list bare', () => {
    expect(carveToHtml('- a\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
  })

  it.each([
    ['- [ ] open\n- [x] done\n- [X] shout\n- [-] dropped\n', '- [ ] open\n- [x] done\n- [x] shout\n- [-] dropped\n'],
    ['{.c}\n- [ ] a\n- [x] b\n', '{.c}\n- [ ] a\n- [x] b\n'],
    ['{#i .c k=v}\n- [x] a\n', '{#i .c k=v}\n- [x] a\n'],
    ['- [x] parent\n  - child\n', '- [x] parent\n  - child\n'],
    ['-{.c} [x] a\n', '-{.c} [x] a\n'],
  ])('survives a render and import cycle: %j', (source, canonical) => {
    expect(cycle(source)).toBe(canonical)
  })

  it('reads task-list as structure only on a list that holds a box', () => {
    expect(htmlToCarve('<ul class="task-list"><li>plain</li></ul>').value).toBe('{.task-list}\n- plain\n')
  })

  it('reads x as the done state only beside a ticked box', () => {
    expect(htmlToCarve('<ul><li data-task-state="x"><input type="checkbox" checked> a</li></ul>').value).toBe('- [x] a\n')
    expect(htmlToCarve('<ul><li data-task-state="X"><input type="checkbox" checked> a</li></ul>').value)
      .toBe('-{data-task-state=X} [x] a\n')
  })

  it('keeps an extended state beside a ticked box as the author attribute it is', () => {
    expect(htmlToCarve('<ul><li data-task-state="-"><input type="checkbox" checked> a</li></ul>').value)
      .toBe('-{data-task-state=-} [x] a\n')
  })
})
