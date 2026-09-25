import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToAst, htmlToCarve, renderCarve } from '../src/index.js'

/**
 * An ordered HTML task item keeps its bracket text and says what it lost
 * (carve-js#2053).
 *
 * `resources/spec/03-blocks-core.ebnf` hangs `task_marker` off `unordered_item`
 * alone, so no Carve source carries a checkbox on an ordered item and no engine
 * can write the faithful answer. What the importer can do is keep the characters
 * the box was read from and stop claiming the conversion was clean: `1. done`
 * with an empty report told a reader nothing went missing.
 *
 * The row is `structure-unspellable`, the code for a structure the AST holds and
 * Carve source cannot spell. That is also why `htmlToAst` keeps the box and
 * stays silent while `htmlToCarve` flattens it and reports: only a writer loses
 * this (PART 12 §16). carve-rs#1904 pinned the wording on the Rust side.
 *
 * Every case asserts the rendered HTML beside the Carve, because bracket text
 * and a checkbox are hard to tell apart in the Carve.
 */

const BOX = '<input type="checkbox"'
const MESSAGE =
  "Wrote an ordered task item's checkbox as its bracket text: a Carve task marker is spelled behind a bullet only, so the item keeps the characters and loses the task-item semantics"

const imported = (html: string) => {
  const result = htmlToCarve(html)
  const rows = result.report.diagnostics
  return {
    carve: result.value,
    html: carveToHtml(result.value),
    rows,
    unspellable: rows.filter((row) => row.code === 'structure-unspellable').map((row) => row.path),
  }
}

describe('an ordered HTML task item declares its lost box', () => {
  it('keeps the bracket text and reports the loss', () => {
    const out = imported('<ol><li><input type="checkbox" checked disabled> done</li></ol>')
    expect(out.carve).toBe('1. [x] done\n')
    expect(out.html).toContain('<li>[x] done</li>')
    expect(out.html).not.toContain(BOX)
    expect(out.unspellable).toEqual(['/ol[1]/li[1]/input[1]'])
    expect(out.rows[0]!.message).toBe(MESSAGE)
    expect(out.rows[0]!.severity).toBe('warning')
  })

  it('keeps an unchecked box as its own pair', () => {
    const out = imported('<ol><li><input type="checkbox" disabled> open</li></ol>')
    expect(out.carve).toBe('1. [ ] open\n')
    expect(out.html).toContain('<li>[ ] open</li>')
    expect(out.unspellable).toHaveLength(1)
  })

  it('keeps the character an extended state was written with', () => {
    // `data-task-state` is the only carrier the HTML has (PART 10 §11), and the
    // bracket text is the marker a bullet would have spelled, so the state
    // survives as text rather than collapsing to an empty box.
    const out = imported('<ol><li data-task-state="?"><input type="checkbox"> maybe</li></ol>')
    expect(out.carve).toBe('1. [?] maybe\n')
    expect(out.html).toContain('<li>[?] maybe</li>')
    expect(out.unspellable).toHaveLength(1)
  })

  it('leaves an item whose whole content was the box non-empty', () => {
    // The shape that wrote a bare continuation marker, `1. +`, once the box was
    // dropped and nothing was left in the item.
    const out = imported('<ol><li><input type="checkbox" checked></li></ol>')
    expect(out.carve).toBe('1. [x]\n')
    expect(out.html).toContain('<li>[x]</li>')
    expect(out.unspellable).toHaveLength(1)
  })

  it('stands the text where the input stood', () => {
    // Not at the head of the item. A box in the middle of a run is unusual HTML,
    // but it is what the document said, and moving it would be a second loss
    // nothing reports.
    const out = imported('<ol><li>before <input type="checkbox" checked> after</li></ol>')
    expect(out.carve).toBe('1. before [x] after\n')
    expect(out.html).toContain('<li>before [x] after</li>')
  })

  it('reports each ordered task item of a list', () => {
    const out = imported('<ol><li><input type="checkbox" checked> a</li><li><input type="checkbox"> b</li></ol>')
    expect(out.carve).toBe('1. [x] a\n2. [ ] b\n')
    expect(out.unspellable).toEqual(['/ol[1]/li[1]/input[1]', '/ol[1]/li[2]/input[1]'])
  })

  it('keeps the box on the tree and reports nothing there', () => {
    // The two exits say different things about the same input, which is the
    // split PART 12 §16 draws: the AST loses nothing, so it declares nothing.
    const ast = htmlToAst('<ol><li data-task-state="?"><input type="checkbox"> maybe</li></ol>')
    expect(ast.report.diagnostics).toEqual([])
    const list = ast.value.children[0]
    expect(list?.type).toBe('list')
    const item = list?.type === 'list' ? list.items[0] : undefined
    expect(item?.checked).toBe(false)
    expect(item?.taskState).toBe('?')
    // And the writer this tree reaches is the one that drops it silently, which
    // is what the flattening exit exists to say out loud.
    expect(renderCarve(ast.value)).toBe('1. maybe\n')
  })

  describe('the controls, which hold on both sides of the change', () => {
    it('keeps a bullet task item’s box and reports nothing', () => {
      // Without this, a change that stopped reading HTML checkboxes altogether
      // passes every case above.
      const out = imported('<ul><li><input type="checkbox" checked disabled> done</li></ul>')
      expect(out.carve).toBe('- [x] done\n')
      expect(out.html).toContain(BOX)
      expect(out.rows).toEqual([])
    })

    it('keeps the boxes of a bullet task list an ordered item holds', () => {
      // The rule is the list the ITEM belongs to. A fix reading the outer list
      // would take the inner box away and report it as unspellable too.
      const out = imported(
        '<ol><li><input type="checkbox" checked><ul><li><input type="checkbox"> in</li></ul></li></ol>',
      )
      expect(out.carve).toBe('1. [x]\n   - [ ] in\n')
      expect(out.html).toContain(BOX)
      expect(out.unspellable).toEqual(['/ol[1]/li[1]/input[1]'])
    })

    it('leaves an ordered item with no box alone', () => {
      const out = imported('<ol><li>plain</li></ol>')
      expect(out.carve).toBe('1. plain\n')
      expect(out.rows).toEqual([])
    })
  })
})
