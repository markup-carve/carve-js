import { expect, it } from 'vitest'
import { sourceCoreEquivalent } from '../src/write-extension-source.ts'

it('C2-X-023: a core readback with another body is not the extension source', () => {
  const expected = { type: 'block_extension' as const, name: 'ex.box', version: '1', children: [],
    fallback: [], source: { form: 'div' as const, name: 'box', body: 'x\n' } }
  const actual = { type: 'div' as const, attrs: { classes: ['box'] },
    children: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, value: 'wrong' }] }] }
  expect(sourceCoreEquivalent(expected, actual)).toBe(false)
})
