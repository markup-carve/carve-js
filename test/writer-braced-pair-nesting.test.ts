import { describe, expect, it } from 'vitest'
import { parse, write } from '../src/index.ts'
import type { DocumentNode, Inline } from '../src/index.ts'

function nestedStrong(depth: number, text: string): DocumentNode {
  let node: Inline = { type: 'text', value: 'x' }
  for (let level = 0; level < depth; level++) node = { type: 'strong', children: [{ type: 'text', value: text }, node] }
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [node] }] }
}

function cpuMs(work: () => unknown): number {
  const started = process.cpuUsage()
  work()
  const used = process.cpuUsage(started)
  return (used.user + used.system) / 1000
}

// C2-W-069: a braced pair behind a text that ends in `{` was written a second time at every level, so the cost
// doubled per level (22 levels took seconds; found by the render fuzz target through the HTML importer).
describe('braced pairs behind a brace', () => {
  it('writes 22 nested strong pairs behind `{` about as fast as behind a letter', () => {
    write(nestedStrong(4, '{'))
    const yardstick = cpuMs(() => write(nestedStrong(22, 'a')))
    expect(cpuMs(() => write(nestedStrong(22, '{')))).toBeLessThan(4 * yardstick + 200)
  }, 120_000)

  it('keeps the bytes, which read back as the same tree', () => {
    const out = write(nestedStrong(3, '{'))
    expect(out).toBe('{*{{*{{*{x*}*}*}\n')
    expect(parse(out).children[0]).toMatchObject({ type: 'paragraph', children: [{ type: 'strong' }] })
  })
})
