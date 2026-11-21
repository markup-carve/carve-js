import { expect, it } from 'vitest'
import { location, locationIndex } from '../run.ts'

function at(bytes: Uint8Array, offset: number): { line: number, column: number } {
  return location(locationIndex(bytes), { code: 'x', severity: 'warning', channel: 'lint', message: '',
    range: { startOffset: offset, endOffset: offset } })!
}

it('C2-T-019: indexed positions equal decoded byte prefixes, including malformed UTF-8 and BOMs', () => {
  let state = 6313
  const next = (): number => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0)
  const samples = [Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0x0a, 0xef, 0xbb, 0xbf, 0xf0, 0x9f, 0x98, 0x80]),
    Uint8Array.from([0xe2, 0x82, 0x61, 0xed, 0xa0, 0x80, 0xc0, 0xaf, 0x0a, 0xff])]
  for (let sample = 0; sample < 5000; sample++) {
    const bytes = new Uint8Array(next() % 28)
    for (let offset = 0; offset < bytes.length; offset++) bytes[offset] = next() >>> 24
    samples.push(bytes)
  }
  for (const bytes of samples) {
    const index = locationIndex(bytes)
    for (let offset = 0; offset <= bytes.length; offset++) {
      const lineStart = offset === 0 ? 0 : bytes.lastIndexOf(0x0a, offset - 1) + 1
      const line = bytes.subarray(0, lineStart).filter((byte) => byte === 0x0a).length + 1
      const column = Array.from(new TextDecoder().decode(bytes.subarray(lineStart, offset))).length + 1
      const entry = { code: 'x', severity: 'warning' as const, channel: 'lint' as const, message: '',
        range: { startOffset: offset, endOffset: offset } }
      expect(location(index, entry), `${bytes.length}:${offset}`).toEqual({ line, column })
    }
  }
})

it('C2-T-019: many findings on one long line use the index once', () => {
  const bytes = Buffer.from('_a_ '.repeat(32768))
  const started = performance.now()
  const index = locationIndex(bytes)
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const entry = { code: 'x', severity: 'warning' as const, channel: 'lint' as const, message: '',
      range: { startOffset: offset, endOffset: offset } }
    expect(location(index, entry)).toEqual({ line: 1, column: offset + 1 })
  }
  expect(performance.now() - started).toBeLessThan(3000)
}, 30_000)

it('C2-T-019: line starts and supplementary code points keep their columns', () => {
  const bytes = Buffer.from('x😀\nα_b_\n')
  expect(at(bytes, 5)).toEqual({ line: 1, column: 3 })
  expect(at(bytes, 7)).toEqual({ line: 2, column: 2 })
  expect(at(bytes, bytes.length)).toEqual({ line: 3, column: 1 })
})
