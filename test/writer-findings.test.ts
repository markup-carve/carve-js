// Writer defects of the engine TODO list, each fixed at its clause.
import { describe, expect, it } from 'vitest'
import { decodeTree, format, formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { checkWriter } from './support/writer-checks.ts'

const comment = { type: 'comment', form: 'line', value: 'x \t ' }
const cell = { type: 'table_cell', header: false, children: [{ type: 'cell_paragraph', children: [{ type: 'text', value: 'a' }] }] }

function written(children: unknown[]): { source: string, codes: string[] } {
  const output = writeWithDiagnostics(decodeTree(JSON.stringify({ type: 'document', astVersion: '2.0', children })))
  return { source: output.source, codes: output.diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`) }
}

describe('line comments', () => {
  it('C2-W-022, C2-W-117: a line comment value that ends with spaces or tabs is written without them, and the loss is reported', () => {
    expect(written([comment])).toEqual({ source: '%% x\n', codes: ['field-unspellable /children/0/value'] })
    expect(written([{ type: 'comment', form: 'line', value: '  ' }])).toEqual({
      source: '%%\n', codes: ['field-unspellable /children/0/value'],
    })
  })

  it('C2-W-022, C2-W-117: so is the value of an inline line comment and of a comment between table rows', () => {
    expect(written([{ type: 'paragraph', children: [{ type: 'text', value: 'a' }, comment] }]))
      .toEqual({ source: 'a %% x\n', codes: ['field-unspellable /children/0/children/1/value'] })
    const table = written([{ type: 'table', columns: [{ type: 'table_column' }],
      children: [{ type: 'table_body', children: [{ type: 'table_row', children: [cell] }, comment] }] }])
    expect(table.source.split('\n').every((line) => !line.endsWith(' ') && !line.endsWith('\t'))).toBe(true)
    expect(table.codes).toEqual(['field-unspellable /children/0/children/0/children/1/value'])
  })
})

it('C2-A-193: source metadata does not make the writer report a loss', () => {
  const document = decodeTree(JSON.stringify({ type: 'document', astVersion: '2.0',
    extensions: [{ name: 'carve.source', version: '1', required: false, slots: [] }],
    children: [{ type: 'paragraph', data: { 'carve.source': {
      format: 'docx', locator: { part: 'word/document.xml', path: '/document/body/p[1]' },
      importer: { name: 'pandoc-carve', version: '2.0' },
    } }, children: [{ type: 'text', value: 'a' }] }] }))
  const result = writeWithDiagnostics(document)
  expect(result.source).toBe('a\n')
  expect(result.diagnostics).toEqual([])
})

it('C2-W-011: field losses name the field path', () => {
  const image = written([{ type: 'paragraph', role: 'image', children: [
    { type: 'image', src: 'x.png', decorative: true },
  ] }])
  expect(image.codes).toContain('field-unspellable /children/0/children/0/decorative')
  const xref = written([{ type: 'paragraph', children: [
    { type: 'text', value: 'see ' }, { type: 'xref', key: 'h', namespace: 'heading', display: 'number' },
  ] }])
  expect(xref.codes).toContain('field-unspellable /children/0/children/1/display')
})

it('C2-W-011: a structure lost after round escapes reports the supplied child path', () => {
  const output = formatWithDiagnostics('//</\\**{#}#}{/\\/{c}`*/')
  expect(output.diagnostics.map((entry) => `${entry.code} ${entry.path}`)).toContain(
    'structure-unspellable /children/0/children/1/children/1',
  )
})

describe('bodies opened behind a task box or attributes', () => {
  const written = (source: string): string => {
    const out = format(source)
    expect(treesEqual(parse(out), parse(source)), out).toBe(true)
    return out
  }

  it('C2-W-033, C2-W-002: the closer of a div or fence opened behind a task box stands at the column of its opener', () => {
    expect(written('- [ ] - :::\n  x\n  :::\n')).toBe('- [ ] - :::\n\n        :::\n\n  x\n\n  :::\n\n  :::\n')
    expect(written('-{.c} . :::\n')).toBe('-{.c} . :::\n\n        :::\n')
    expect(written('- [ ] . ```\n  code\n  ```\n')).toBe('- [ ] . ```\n        ```\n\n  code\n\n  ```\n  ```\n')
    expect(written('> - [ ] - :::\n>         x\n>         :::')).toBe('> - [ ] - :::\n>         x\n>         :::\n')
  })

  it('C2-W-002: continuation lines of an item opened behind a task box stand at its content column', () => {
    expect(written('- [ ] - a\n\n        b')).toBe('- [ ] - a\n\n        b\n')
    expect(written('1. [x] - ```\n         x\n         ```')).toBe('1. [x] - ```\n         x\n         ```\n')
  })

  it('C2-W-002: a block opened on the marker line of a footnote behind a list marker is written, not refused', () => {
    expect(written('[^n]: * :::')).toBe('[^n]: * :::\n\n        :::\n')
    expect(written('[^n]: * :::\n\n[x]^[n]')).toBe('[^n]: * :::\n\n        :::\n\n[x]^[n]\n')
  })
})

describe('a comment between a code block and its caption', () => {
  it('C2-W-059: a line comment after a code block with a caption stands between the closer and the caption line', () => {
    expect(format('```\nx\n```\n%% c\n^ cap')).toBe('```\nx\n```\n%% c\n^ cap\n')
    expect(format('```\nx\n```\n%% c\n%% d\n^ cap\n\npara')).toBe('```\nx\n```\n%% c\n%% d\n^ cap\n\npara\n')
    expect(format('- ```\n  x\n  ```\n  %% c\n  ^ cap')).toBe('- ```\n  x\n  ```\n  %% c\n  ^ cap\n')
  })
})

describe('delimited tables', () => {
  it('C2-W-005, C2-B-226: a last row of one empty cell is written quoted, since an empty last line is dropped', () => {
    const source = '{table}\n```csv\na\n""\n```'
    expect(format(source)).toBe('{table}\n```csv\na\n""\n```\n')
    expect(format('{table}\n```csv\na\n\nb\n```')).toBe('{table}\n```csv\na\n\nb\n```\n')
  })
})

describe('lists around a comment', () => {
  it('C2-W-122: the attribute line of the second list follows the first after one blank line (writer Example 12)', () => {
    expect(format('- a\n\n\n{.c}\n%% x\n- b')).toBe('- a\n\n{.c}\n%% x\n- b\n')
  })
})

describe('the slow reference of the escapes', () => {
  it('C2-W-125: where no case gives the tree alone, the backslash of case six is kept and the brace stays bare', () => {
    for (const mark of ['.c}', '', '*', '/', '-', '=', '%', '#']) {
      const source = `x{${mark}\\\`\`a\`\\\``
      expect(checkWriter(source), source).toBeNull()
      expect(format(source)).toBe(`${source}\n`)
    }
  })
})

describe('the four-token gate', () => {
  it('C2-W-088, C2-W-125: where one backslash gives the tree alone, case six adds none behind it', () => {
    const slash = String.fromCharCode(92)
    const tick = String.fromCharCode(96)
    // C2-W-088 (carve-js#5283, option B): in `x(/u)\\//}/}` the reported slash kind escapes the last slash too.
    expect(format(`x(/u)${slash}//}/}`)).toBe(`x(/u)${slash}//}${slash}/}\n`)
    const inputs = [`x(/u)${slash}//}/`, `x(/u)${slash}//}${slash}/}`, `x${slash}${tick}${tick}a${tick}{.c}}`]
    for (const source of inputs) {
      expect(checkWriter(source), source).toBeNull()
      expect(format(source)).toBe(`${source}\n`)
    }
  })
})

describe('hard-break blocks', () => {
  it('C2-W-022, C2-I-102: a hard break at the start of a line of a hard-break block keeps its backslash, so no blank line splits the paragraph', () => {
    const slash = String.fromCharCode(92)
    for (const source of [`::: ${slash}\none\ntwo\n:\n\n ${slash}\none\ntwo\n:::`, `::: ${slash}\na\n${slash}\nb\n:::`]) {
      expect(checkWriter(source), source).toBeNull()
    }
  })
})
