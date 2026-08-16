import { describe, expect, it } from 'vitest'

import { htmlToAst, htmlToCarve } from '../src/index.js'

/**
 * `<colgroup>` is dropped, and now says it is.
 *
 * Carve has no column model - a table's columns are only the cells its rows
 * carry - and whether it should get one is a language question
 * (`markup-carve/carve#1092`), not this importer's to answer. What the importer
 * owes meanwhile is a name for the loss: the element went in complete silence,
 * because the table walk looks for `tr`, descends through the `<colgroup>` and
 * finds none.
 *
 * The wording is verbatim from `markup-carve/carve-rs#1006`, so the engines
 * report the same drop in the same words.
 *
 * Only `<colgroup>` is scanned for. "In table" insertion mode answers a `col`
 * start tag by inserting an implied `<colgroup>` first, so a `<col>` is never a
 * direct child of a `<table>` after parsing and a `col` arm could match nothing
 * on any input - the check that cannot fail, `markup-carve/carve#755`. That is
 * pinned below as a property of the parser rather than assumed.
 */

const MESSAGE =
  "Dropped <colgroup>: Carve has no column model, and a table's columns are only the cells its rows carry"

const diagnostics = (html: string): Array<Record<string, unknown>> =>
  htmlToCarve(html, { mode: 'semantic' }).report.diagnostics as unknown as Array<Record<string, unknown>>

const dropped = (html: string): Array<Record<string, unknown>> =>
  diagnostics(html).filter((diagnostic) => diagnostic.message === MESSAGE)

describe('a dropped colgroup says so', () => {
  it('names the element, its severity and its own path', () => {
    const html = '<table><colgroup><col span="2"></colgroup><tr><td>a</td><td>b</td></tr></table>'
    expect(diagnostics(html)).toEqual([
      {
        code: 'element-dropped',
        message: MESSAGE,
        severity: 'warning',
        path: '/table[1]/colgroup[1]',
      },
    ])
  })

  it('keeps the rest of the table', () => {
    // The report is the only thing that changes: a column description Carve
    // cannot hold is not a reason to lose the cells that it can.
    const html = '<table><colgroup><col><col></colgroup><tr><td>a</td><td>b</td></tr></table>'
    expect(htmlToCarve(html, { mode: 'semantic' }).value).toBe('| a | b |\n')
  })

  it('gives each of two colgroups its OWN path, not the table\'s', () => {
    // The path is the assertion that matters here. Collapsing every diagnostic
    // onto the table's own path still passes a test that reads only codes and
    // messages, and two colgroups reported under one path is a report that
    // cannot say which element went.
    const html = '<table><colgroup></colgroup><colgroup span="3"></colgroup><tr><td>a</td></tr></table>'
    const paths = dropped(html).map((diagnostic) => diagnostic.path)
    expect(paths).toEqual(['/table[1]/colgroup[1]', '/table[1]/colgroup[2]'])
    expect(new Set(paths).size).toBe(2)
    expect(paths).not.toContain('/table[1]')
  })

  it('counts the siblings before it, as every other child path here does', () => {
    // `<caption>` is child one, so the `<colgroup>` is child two. The importer
    // numbers a child by its position among ALL of the parent's children, which
    // is what the second-caption report already does, and a path built from a
    // per-name count would say `colgroup[1]` for an element that is not first.
    const html =
      '<table><caption>C</caption><colgroup><col></colgroup><thead><tr><th>h</th></tr></thead>'
      + '<tbody><tr><td>a</td></tr></tbody></table>'
    expect(dropped(html).map((diagnostic) => diagnostic.path)).toEqual(['/table[1]/colgroup[2]'])
  })

  it('reports it under the table\'s own place in the document', () => {
    const html = '<blockquote><table><colgroup><col></colgroup><tr><td>a</td></tr></table></blockquote>'
    expect(dropped(html).map((diagnostic) => diagnostic.path)).toEqual([
      '/blockquote[1]/table[1]/colgroup[1]',
    ])
  })

  it('says it in every mode', () => {
    // The element has no representation anywhere, so no mode can keep it -
    // including `roundtrip`, where an unsupported element is otherwise
    // preserved verbatim rather than lost.
    const html = '<table><colgroup><col></colgroup><tr><td>a</td></tr></table>'
    for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      const report = htmlToCarve(html, { mode }).report.diagnostics
      expect(report.filter((diagnostic) => diagnostic.message === MESSAGE)).toHaveLength(1)
    }
  })

  it('CONTROL: a table without one reports nothing', () => {
    // Without this, an arm that fired on every table would still pass every
    // assertion above.
    const html = '<table><tr><td>a</td><td>b</td></tr></table>'
    expect(diagnostics(html)).toEqual([])
  })

  it('leaves the AST a plain table', () => {
    const html = '<table><colgroup span="2"></colgroup><tr><td>a</td></tr></table>'
    const table = htmlToAst(html, { mode: 'semantic' }).value.children[0] as unknown as Record<string, unknown>
    expect(table.type).toBe('table')
    // The element contributes no node and no attribute slot: it is an ELEMENT
    // loss, and reporting it as an attribute one would claim a home it has not
    // got.
    expect(Object.keys(table).sort()).toEqual(['rows', 'type'])
  })

  describe('the implied wrapper is what arrives', () => {
    /*
     * These pin the reason there is no `col` arm. If the parser ever stopped
     * inserting the implied `<colgroup>`, a bare `<col>` would go silent again
     * and these would be the tests that said so - which is the job a dead
     * `| "col"` arm was written to do and could not.
     */
    it('wraps a bare `<col>` run in one implied colgroup and reports that', () => {
      const html = '<table><col span="2"><col><tr><td>a</td><td>b</td></tr></table>'
      expect(diagnostics(html)).toEqual([
        {
          code: 'element-dropped',
          message: MESSAGE,
          severity: 'warning',
          path: '/table[1]/colgroup[1]',
        },
      ])
    })

    it('wraps a lone `<col>` in a table with no rows at all', () => {
      expect(dropped('<table><col></table>').map((diagnostic) => diagnostic.path)).toEqual([
        '/table[1]/colgroup[1]',
      ])
    })

    it('separates the runs an explicit colgroup breaks', () => {
      // Two reports, not one: the explicit wrapper closes and the `<col>` after
      // it opens a second implied one. Both are the element that went.
      const html = '<table><colgroup><col></colgroup><col><tr><td>a</td></tr></table>'
      expect(dropped(html).map((diagnostic) => diagnostic.path)).toEqual([
        '/table[1]/colgroup[1]',
        '/table[1]/colgroup[2]',
      ])
    })
  })
})
