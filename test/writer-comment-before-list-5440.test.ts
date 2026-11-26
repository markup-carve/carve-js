import { describe, expect, it } from 'vitest'
import { type DocumentNode, writeWithDiagnostics } from '../src/index.ts'

const text = (value: string) => ({ type: 'text', value }) as const
const paragraph = (value: string) => ({ type: 'paragraph', children: [text(value)] }) as const
const item = (value: string) => ({ type: 'list_item', children: [paragraph(value)] }) as const
const bullet = (value: string, attrs?: object) => ({
  type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight', children: [item(value)], ...(attrs && { attrs }),
}) as const
const description = (value: string, attrs?: object) => ({
  type: 'definition_list', ...(attrs && { attrs }), children: [
    { type: 'definition_term', children: [text('t')] }, { type: 'definition_description', children: [paragraph(value)] }],
}) as const
const line = (value: string) => ({ type: 'comment', form: 'line', value }) as const
const block = (value: string) => ({ type: 'comment', form: 'block', value }) as const

function written(...children: unknown[]): { source: string, paths: string[] } {
  const tree = JSON.parse(JSON.stringify({ type: 'document', astVersion: '2.0', children })) as DocumentNode
  const output = writeWithDiagnostics(tree)
  return { source: output.source, paths: output.diagnostics.map((entry) => `${entry.code} ${entry.path}`) }
}

describe('C2-W-122: three blank lines between a comment and the second list of one kind (carve-js#5440)', () => {
  it('keeps them where a line comment the list above reads in comes before a comment block', () => {
    expect(written(bullet('a'), line('c'), block('d'), bullet('b', { classes: ['c'] }))).toEqual({
      source: '- a\n\n%% c\n%%%\nd\n%%%\n\n\n\n{.c}\n- b\n', paths: ['structure-unspellable /children/1'],
    })
  })

  it('counts them as without the line comment', () => {
    expect(written(bullet('a'), block('d'), bullet('b', { classes: ['c'] })).source)
      .toBe('- a\n\n%%%\nd\n%%%\n\n\n\n{.c}\n- b\n')
  })

  it('keeps them between two description lists', () => {
    expect(written(description('a'), line('c'), block('d'), description('b', { classes: ['c'] }))).toEqual({
      source: ':: t\n: a\n\n%% c\n%%%\nd\n%%%\n\n\n\n{.c}\n:: t\n: b\n', paths: ['structure-unspellable /children/1'],
    })
  })
})
