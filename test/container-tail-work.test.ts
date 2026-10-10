import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

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

for (const marker of ['> ', '- ', '> - ', '- > ', '1. ', '. ', 'iv) ', '- [ ] ', '* [x] ', '-{.x} ', '1.{title="😀"} ', '-{.x} [ ] ']) {
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

for (const [name, sourceAt, suffixAt] of [
  ['lazy quote', (depth: number) => '> '.repeat(depth) + 'end\nlazy\n', (depth: number) => depth * 4],
  ['trailing blanks in a descendant fence', (depth: number) => '- '.repeat(depth) + 'a\n' + '  '.repeat(depth) + '```\n\n', () => 0],
  ['CRLF blank-separated list continuation', (depth: number) => '- '.repeat(depth) + 'a\r\n\r\n' + '  '.repeat(depth) + 'b\r\n', () => 0],
  ['blank-separated comment continuation', (depth: number) => '- '.repeat(depth) + 'a\n\n' + '  '.repeat(depth) + '%% note\n', () => 0],
  ['blank-separated list continuation', (depth: number) => '- '.repeat(depth) + 'a\n\n' + '  '.repeat(depth) + 'b\n', () => 0],
  ['comment list continuation', (depth: number) => '- '.repeat(depth) + 'a\n' + '  '.repeat(depth) + '%% note\n', () => 0],
  ['indented list continuation', (depth: number) => '- '.repeat(depth) + 'a\n' + '  '.repeat(depth) + 'b\n', () => 0],
] as const) {
  it(`bounds remaining tail work for ${name}`, () => {
    const rows = [32, 64, 128].map(depth => {
      const source = sourceAt(depth)
      const row = work(source)
      expect(row.ast).toEqual(parse(source))
      expect(row.suffixChars).toBe(suffixAt(depth))
      expect(row.terminatorInputs).toBeLessThanOrEqual(source.length * 5)
      return row
    })
    // Compare added work so a fixed startup offset cannot distort the ratio.
    // Doubling the added input doubles linear work and quadruples quadratic work.
    expect(rows[2]!.matched - rows[1]!.matched)
      .toBeLessThanOrEqual((rows[1]!.matched - rows[0]!.matched) * 2.1)
  })
}

for (const source of [
  '- '.repeat(64) + 'a\n' + '\t'.repeat(32) + 'leaf\n',
  '-{title="😀"} leaf\n',
  '1.{title="😀"} - [x] leaf\r\n',
  '-{.x} -{.y} leaf\n',
  '- [ ] a\r\n  - b\r\n    leaf\r\n',
  '- a\n  - b\n\tleaf\n',
  '- a\n \t- leaf\n',
  '- a\n  - b\n    +\n    leaf\n',
  '> -{.x} leaf\n',
  '> > leaf\ncontinuation\n',
  '-{title="x\u2028y"} leaf\n',
  '-{.x} leaf\u2029\n',
]) {
  it(`keeps the leaf source slice for ${JSON.stringify(source)}`, () => {
    const points = Array.from(source)
    let found = false
    function visit(value: unknown): void {
      if (!value || typeof value !== 'object') return
      const node = value as { type?: string, value?: string, pos?: { startOffset: number, endOffset: number } }
      if (node.type === 'text' && node.value?.includes('leaf')) {
        found = true
        expect(node.pos).toBeDefined()
        expect(points.slice(node.pos!.startOffset, node.pos!.endOffset).join('')).toBe(node.value)
      }
      for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit)
    }
    visit(parse(source))
    expect(found).toBe(true)
  })
}

for (const marker of ['-{.x} ', '1.{.x} ', '-{.x} [ ] ']) {
  it(`avoids the instrumented attributed-tail fallback for ${JSON.stringify(marker)}`, () => {
    for (const depth of [32, 64, 128]) {
      const source = marker.repeat(depth) + 'x'.repeat(100_000) + '\n'
      const previous = layoutWork.on
      layoutWork.reset()
      layoutWork.on = true
      try {
        const ast = parse(source)
        // Guard the copying fallback getter, not uninstrumented engine string copies.
        expect(layoutWork.seam - source.length).toBe(0)
        expect(renderHtml(ast)).toContain('x'.repeat(100_000))
      } finally {
        layoutWork.on = previous
        layoutWork.reset()
      }
    }
  })
}
