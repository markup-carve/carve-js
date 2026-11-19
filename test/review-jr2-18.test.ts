import { expect, it } from 'vitest'
import { decodeTree, render } from '../src/index.ts'

it('C2-H-176: a supplied mention target with an unpaired surrogate renders safely', () => {
  const json = JSON.stringify({ type: 'document', astVersion: '2.0', children: [
    { type: 'paragraph', children: [{ type: 'mention', kind: 'user', target: '\ud800', label: 'ok' }] },
  ] })
  const tree = decodeTree(json)
  expect(render(tree, { social: { mentionUrl: '/u/{name}' } }))
    .toBe('<p><a class="mention" href="/u/%EF%BF%BD">ok</a></p>')
})
