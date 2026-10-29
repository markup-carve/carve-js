import { describe, expect, it } from 'vitest'
import { run, type CliIO } from '../src/cli.js'
import { decisionTrace, decisionTraceJsonLines } from '../src/index.js'
import { ownLines } from '../src/parse/block/block-ownership.js'

// Records and step ids of carve docs/decision-trace.md, format version 1.
describe('decision trace', () => {
  it('writes the documented example record for record', () => {
    expect(decisionTraceJsonLines('- a\n  > q\nlazy\n').split('\n')).toEqual([
      '{"trace":"carve-decision-trace","version":1,"engine":"carve-js"}',
      '{"line":1,"step":"S5","owner":"doc/item:1","rule":"CARVE-P0-024","form":"item","cell":"B-item-start"}',
      '{"line":2,"step":"S5","owner":"doc/item:1/quote:2","rule":"CARVE-P0-024","form":"quote","cell":"B-quote-start"}',
      '{"line":3,"step":"S4","owner":"doc/item:1/quote:2","rule":"CARVE-P0-006","form":"lazy","reached":"doc"}',
      '',
    ])
  })

  it('records frontmatter as INPUT and a fence payload and closer as S1', () => {
    expect(decisionTrace('---\nk: v\n---\n- ```\n  x\n  ```\n\ny\n')).toEqual([
      { line: 1, step: 'INPUT', owner: 'doc', rule: null, form: 'frontmatter' },
      { line: 2, step: 'INPUT', owner: 'doc', rule: null, form: 'frontmatter' },
      { line: 3, step: 'INPUT', owner: 'doc', rule: null, form: 'frontmatter' },
      { line: 4, step: 'S5', owner: 'doc/item:4/code:4', rule: 'CARVE-P0-024', form: 'item', cell: 'B-item-start' },
      { line: 5, step: 'S1', owner: 'doc/item:4/code:4', rule: 'CARVE-P0-005', form: 'payload', cell: 'B-code-keep' },
      { line: 6, step: 'S1', owner: 'doc/item:4/code:4', rule: 'CARVE-P0-005', form: 'closer', cell: 'B-code-end' },
      { line: 7, step: 'S5', owner: 'doc/item:4', rule: 'CARVE-P0-003', form: 'blank' },
      { line: 8, step: 'S5', owner: 'doc', rule: 'CARVE-P0-024', form: 'text', closed: 1, reached: 'doc' },
    ])
  })

  it('records an accepted plus as S2 and marks its follower', () => {
    expect(decisionTrace('- a\n+\n> q\n')).toEqual([
      { line: 1, step: 'S5', owner: 'doc/item:1', rule: 'CARVE-P0-024', form: 'item', cell: 'B-item-start' },
      { line: 2, step: 'S2', owner: 'doc/item:1', rule: 'CARVE-P9-067', form: 'plus', cell: 'B-plus-start' },
      { line: 3, step: 'S5', owner: 'doc/quote:3', rule: 'CARVE-P0-024', form: 'quote', cell: 'B-quote-start', closed: 1, reached: 'doc', plus: 2 },
    ])
  })

  it('names div, comment and line-block owners and a div closer', () => {
    const trace = decisionTrace('::: note\n%%%\nc\n%%%\n:::\n::: |\nl\n:::\n')
    expect(trace.map((r) => [r.step, r.owner, r.form, r.cell])).toEqual([
      ['S5', 'doc/div:1', 'div', 'B-div-start'],
      ['S5', 'doc/div:1/comment:2', 'comment', 'B-comment-start'],
      ['S1', 'doc/div:1/comment:2', 'payload', 'B-comment-keep'],
      ['S1', 'doc/div:1/comment:2', 'closer', 'B-comment-end'],
      ['S5', 'doc/div:1', 'closer', 'B-div-end'],
      ['S5', 'doc/div:6', 'div', 'B-div-start'],
      ['S1', 'doc/div:6', 'payload', 'B-div-keep'],
      ['S1', 'doc/div:6', 'closer', 'B-div-end'],
    ])
  })

  it('leaves the walk output unchanged', () => {
    const lines = ['- a', '  > q', 'lazy', '+', '```', 'x']
    expect(ownLines([...lines], 0, [])).toEqual(ownLines([...lines], 0))
  })

  it('prints the trace from carve trace', async () => {
    let out = ''
    const io: CliIO = {
      readStdin: async () => '',
      write: (s) => { out += s },
      writeErr: () => {},
      readFile: () => '# h\n',
      writeFile: () => {},
    }
    expect(await run(['trace', 'doc.crv'], io)).toBe(0)
    expect(out).toBe(decisionTraceJsonLines('# h\n'))
    expect(out.split('\n')[1]).toBe('{"line":1,"step":"S5","owner":"doc","rule":"CARVE-P0-011","form":"leaf"}')
  })
})
