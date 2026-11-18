import { expect, it } from 'vitest'
import { parse, type ExtensionDefinition } from '../src/index.ts'

it('C2-N-020: a selected include does not change an independent nested parse', () => {
  const observed: string[] = []
  const ping: ExtensionDefinition = { name: 'test.ping', version: '1', matcher: { form: 'div', name: 'ping' },
    props: {}, slots: {}, transform: () => {
      observed.push(parse('---\nx\n---').children[0]?.type ?? '')
      return undefined as never
    } }
  parse('{{ f @lines:3-5 }}', { extensions: [ping], includes: { resolver: () =>
    ({ id: 'f', text: 'one\n\n::: ping\nx\n:::\n' }) } })
  expect(observed.length).toBeGreaterThan(0)
  expect(observed).toEqual(observed.map(() => 'frontmatter'))
})
