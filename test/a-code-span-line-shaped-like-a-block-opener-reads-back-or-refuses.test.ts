import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, renderCarve, renderHtml } from '../src/index.js'
import type { Document } from '../src/ast.js'
import { SourceUnspellableError } from '../src/source/source-unspellable-error.js'

// carve-js#3939: a code value line shaped like a block opener is written in a
// spelling that re-reads to the same tree, or refused under CARVE-P11-046.
const HOSTS: Record<string, (span: string) => string> = {
  paragraph: span => span,
  quote: span => `> ${span.replace(/\n/g, '\n> ')}`,
  bullet: span => `- ${span.replace(/\n/g, '\n  ')}`,
  ordered: span => `1. ${span.replace(/\n/g, '\n   ')}`,
  nested: span => `- p\n\n  - ${span.replace(/\n/g, '\n    ')}`,
  description: span => `:: t\n: ${span.replace(/\n/g, '\n  ')}`,
  footnote: span => `y[^n]\n\n[^n]: ${span.replace(/\n/g, '\n  ')}`,
  quotedItem: span => `> - ${span.replace(/\n/g, '\n>   ')}`,
  div: span => `::: d\n${span}\n:::`,
}

const LINES = [
  '> b', '>', '[d]: u', '[^d]: u', '*[H]: x', '- b', '* b', '1. b', 'a) b', '. b', '# h', '```x', '~~~',
  '::: x', ':::', '{.c}', '%% c', '%%%', '| x |', '+', '+ b', '***', '---', '^ c', ':: t', ': d',
]

function withCode(host: string, prefix: string, value: string): Document {
  const document = parse(`${HOSTS[host]!(`${prefix}\`QQ\``)}\n`)
  const stack: unknown[] = [document]
  let found = 0
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === null || typeof node !== 'object') continue
    const record = node as Record<string, unknown>
    if (record['type'] === 'code' && record['value'] === 'QQ') {
      record['value'] = value
      found++
    }
    stack.push(...Object.values(record))
  }
  expect(found).toBe(1)
  return document
}

describe('a code value line shaped like a block opener reads back or refuses', () => {
  for (const host of Object.keys(HOSTS)) {
    for (const prefix of ['', 'x ']) {
      for (const line of LINES) {
        for (const value of [`a\n${line}`, `a\n${line}\nc`]) {
          it(`${host} ${JSON.stringify(prefix + value)}`, () => {
            const document = withCode(host, prefix, value)
            const html = renderHtml(document)
            let written: string
            try {
              written = renderCarve(document)
            } catch (error) {
              expect(error).toBeInstanceOf(SourceUnspellableError)
              expect(error).toMatchObject({ nodeType: 'code' })
              return
            }
            expect(carveToHtml(written)).toBe(html)
            expect(carveToCarve(written)).toBe(written)
          })
        }
      }
    }
  }
})

it.each(Object.keys(HOSTS))('pads a last definition-shaped line so the closer ends its destination: %s', host => {
  const written = renderCarve(withCode(host, '', 'a\n[d]: u'))
  expect(written).toContain('[d]: u `')
  expect(carveToHtml(written)).toBe(renderHtml(withCode(host, '', 'a\n[d]: u')))
})

it.each(['quote', 'bullet', 'quotedItem', 'div'])('spells a last colon-run line with the closer on it: %s', host => {
  const document = withCode(host, '', 'a\n:::')
  const written = renderCarve(document)
  expect(written).toMatch(/:::`$/m)
  expect(carveToHtml(written)).toBe(renderHtml(document))
})

it.each([
  ['paragraph', 'a\n> b'],
  ['paragraph', 'a\n# h'],
  ['bullet', 'a\n- b'],
  ['ordered', 'a\n1. b'],
  ['quote', 'a\n[^d]: u'],
  ['div', 'a\n:: t'],
  ['description', 'a\n%% c'],
  ['paragraph', 'a\n[d]: u\nc'],
  ['quote', 'a\n***\nc'],
])('refuses a value no spelling keeps inside its span: %s %j', (host, value) => {
  expect(() => renderCarve(withCode(host, '', value))).toThrow(SourceUnspellableError)
})
