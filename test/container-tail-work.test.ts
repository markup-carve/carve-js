import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

function work(source: string) {
  const exec = RegExp.prototype.exec
  const endsWith = String.prototype.endsWith
  let matched = 0, suffixChars = 0, terminatorInputs = 0
  RegExp.prototype.exec = function (input: string) {
    if (this.source === String.raw`[\n\r\u2028\u2029]`) terminatorInputs += input.length
    const result = Reflect.apply(exec, this, [input])
    matched += result?.[0].length ?? 0
    return result
  }
  String.prototype.endsWith = function (suffix: string, end?: number) {
    suffixChars += suffix.length
    return Reflect.apply(endsWith, this, [suffix, end])
  }
  try { return { ast: parse(source), get matched() { return matched }, get suffixChars() { return suffixChars }, get terminatorInputs() { return terminatorInputs } } }
  finally { RegExp.prototype.exec = exec; String.prototype.endsWith = endsWith }
}

for (const marker of ['> ', '- ', '> - ', '- > ']) {
  it(`bounds successful regex spans and suffix checks for ${JSON.stringify(marker)}`, () => {
    const rows = [32, 64].map(depth => {
      const source = marker.repeat(depth) + 'end\n'
      const row = work(source)
      expect(row.ast).toEqual(parse(source))
      expect(row.suffixChars).toBe(0)
      expect(row.terminatorInputs).toBeLessThanOrEqual(source.length * 3)
      return row
    })
    expect(rows[1]!.matched).toBeLessThanOrEqual(rows[0]!.matched * 2.1)
  })
}

for (const marker of ['> ', '- ']) {
  for (const terminal of ['\u2028', '\u2029']) {
    it(`preserves the regex fallback for ${JSON.stringify(marker + terminal)}`, () => {
      const source = marker.repeat(3) + 'x' + terminal + '\n'
      const ast = parse(source)
      expect(work(source).ast).toEqual(ast)
      expect(renderHtml(ast)).toContain(terminal)
    })
  }
  it(`keeps Unicode leaf coordinates under ${JSON.stringify(marker)}`, () => {
    const source = marker.repeat(16) + '😀 café\n'
    let nodes: unknown[] = [parse(source)]
    let found = false
    while (nodes.length) {
      const node = nodes.pop() as { type?: string, value?: string, pos?: { startOffset: number, endOffset: number }, children?: unknown[], items?: unknown[] }
      if (node.type === 'text' && node.value === '😀 café') {
        found = true
        expect(node.pos?.startOffset).toBe(32)
        expect(node.pos?.endOffset).toBe(38)
      }
      if (node.children) nodes.push(...node.children)
      if (node.items) nodes.push(...node.items)
    }
    expect(found).toBe(true)
  })
}

for (const [source, offsets] of [
  ['>\n> x\n', [4]],
  ['-   x\n', [4]],
  ['* \tx\n', [3]],
  ['> x\r\n> y\r\n', [2, 7]],
  ['- x\r\n  y\r\n', [2, 7]],
  ['> - x\n', [4]],
] as const) {
  it(`preserves stripped-prefix positions in ${JSON.stringify(source)}`, () => {
    const starts: number[] = []
    function visit(value: unknown): void {
      if (!value || typeof value !== 'object') return
      const node = value as { type?: string, pos?: { startOffset: number } }
      if (node.type === 'text') starts.push(node.pos!.startOffset)
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(visit)
      }
    }
    visit(parse(source))
    expect(starts).toEqual(offsets)
  })
}
