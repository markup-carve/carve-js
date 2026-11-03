import { describe, expect, it } from 'vitest'
import { parse, renderCarve, SourceUnspellableError } from '../src/index.js'
import type { Document, InlineNode } from '../src/index.js'

// A carriage return in a constructed verbatim value is a line break once written,
// so the read-back check that catches a continuation line opening a block covers it too.
const span = (type: string, value: string): InlineNode => (type === 'code'
  ? { type: 'code', value }
  : { type: 'math', display: type === 'display', content: value }) as InlineNode
const doc = (node: InlineNode): Document => ({ type: 'document', children: [{ type: 'paragraph', children: [node] }] })
const payloads = (root: unknown): string[] => {
  const out: string[] = []
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach(visit)
    const record = value as Record<string, unknown>
    if (record['type'] === 'code') out.push(record['value'] as string)
    if (record['type'] === 'math') out.push(record['content'] as string)
    for (const [key, child] of Object.entries(record)) if (key !== 'pos') visit(child)
  }
  visit(root)
  return out
}

describe('a carriage return in a verbatim value', () => {
  for (const type of ['code', 'inline', 'display']) {
    for (const separator of ['\r', '\r\n']) {
      it(`refuses a ${type} value whose continuation opens a block after ${JSON.stringify(separator)}`, () => {
        for (const line of ['> b', '# b', '%% c']) {
          expect(() => renderCarve(doc(span(type, `a${separator}${line}`)))).toThrow(SourceUnspellableError)
        }
      })

      it(`writes a ${type} value that reads back after ${JSON.stringify(separator)}`, () => {
        for (const line of ['[r]: /t', '- b', 'b']) {
          const out = renderCarve(doc(span(type, `a${separator}${line}`)))
          expect(payloads(parse(out))).toEqual([`a\n${line}`])
        }
      })
    }
  }
})
