import { expect, it } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'
import type { CarveExtension } from '../src/extension.js'

it('restores gaps returned by an inline matcher on a line without source gaps', () => {
  const extension: CarveExtension = {
    name: 'verse-gap',
    matchInline(text, pos) {
      return text[pos] === '§'
        ? { node: { type: 'code', value: 'a\0b', attrs: { keyValues: { note: 'c\0d' } } }, end: pos + 1 }
        : null
    },
  }
  const source = '::: |\n§\n:::\n'
  const options = { extensions: [extension] }
  const document = parse(source, options)
  expect(JSON.stringify(document)).toContain('a\u00a0b')
  expect(JSON.stringify(document)).toContain('c\u00a0d')
  expect(carveToHtml(source, options)).toContain('a&nbsp;b')
})
