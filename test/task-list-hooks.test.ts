import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToCarve, htmlToCarve, htmlToAst } from '../src/index.js'

describe('task-list HTML hooks', () => {
  it('classifies nested lists independently and exposes completed items', () => {
    const source = '- [ ] open\n- [X] done\n  - child\n'
    const html = carveToHtml(source)
    expect(html.match(/class="task-list"/g)).toHaveLength(1)
    expect(html).toContain('<ul>\n')
    expect(html).toContain('<li data-task-state="x">')
    expect(html).toContain('<li><input type="checkbox" disabled')
    expect(carveToCarve(htmlToCarve(html).value)).toBe(carveToCarve(source))
  })

  it('merges the base class in the authored slot without duplicating it', () => {
    expect(carveToHtml('{#tasks .task-list .c}\n- [x] done')).toContain('<ul id="tasks" class="task-list c">')
  })

  it('does not classify ordinary or ordered lists from nested tasks', () => {
    expect(carveToHtml('- parent\n  - [x] child').match(/class="task-list"/g)).toHaveLength(1)
    expect(carveToHtml('1. plain')).not.toContain('task-list')
  })

  it('consumes checked hooks without creating an extended AST state', () => {
    const html = '<ul class="task-list c"><li data-task-state="x"><input type="checkbox" checked disabled> done</li></ul>'
    const source = htmlToCarve(html).value
    expect(source).not.toContain('task-list')
    expect(source).not.toContain('data-task-state')
    expect(source).toContain('[x] done')
    const ast = htmlToAst(html).value
    expect(JSON.stringify(ast)).not.toContain('taskState')
  })

  it('retains authored task-list classes on lists with no checkboxes', () => {
    expect(htmlToCarve('<ul class="task-list"><li>plain</li></ul>').value).toContain('.task-list')
  })

  it('emits one authoritative checked hook despite an authored collision', () => {
    const html = carveToHtml('-{DATA-TASK-STATE=?} [x] done')
    expect(html.match(/data-task-state=/gi)).toHaveLength(1)
    expect(html).toContain('data-task-state="x"')
  })
  it('retains every extended state through HTML rendering and import', () => {
    for (const state of ['-', '_', '>', '?']) {
      const source = `- [${state}] task\n`
      const html = carveToHtml(source)
      const escaped = state === '>' ? '&gt;' : state
      expect(html).toContain(`data-task-state="${escaped}"`)
      expect(html).toContain('<input type="checkbox" disabled')
      expect(carveToCarve(htmlToCarve(html).value)).toBe(source)
    }
  })

})
