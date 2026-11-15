import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { LINE_SHAPES } from '../test/support/enumerate.ts'
import { WRITER_TOKENS } from '../test/support/inline-enumerate.ts'

export interface Random {
  int(limit: number): number
  bool(): boolean
}

export function random(seed: number): Random {
  let state = (seed >>> 0) || 0x9e3779b9
  return {
    int(limit: number): number {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      return (state >>> 0) % Math.max(1, limit)
    },
    bool(): boolean { return this.int(2) === 0 },
  }
}

function files(root: string, suffix: string, output: string[]): void {
  try {
    for (const name of readdirSync(root).sort()) {
      const path = join(root, name)
      if (statSync(path).isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'findings'].includes(name)) files(path, suffix, output)
      } else if (extname(path) === suffix) output.push(path)
    }
  } catch { /* an optional checkout is absent */ }
}

function strings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    if (value.length > 0 && value.length < 300) output.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) strings(item, output)
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      output.push(key)
      strings(item, output)
    }
  }
}

export interface Corpus {
  documents: string[]
  dictionary: string[]
  focused: string[]
}

export function loadCorpus(extra?: string): Corpus {
  const paths: string[] = []
  const focusedPaths: string[] = []
  files('v2/test/fixtures', '.crv', paths)
  files('v2/proptest/corpus', '.crv', focusedPaths)
  if (extra !== undefined) files(extra, '.crv', paths)
  const examples = JSON.parse(readFileSync('v2/data/examples.json', 'utf8')) as { input: string }[]
  const documents = [...examples.map((item) => item.input), ...paths.map((path) => readFileSync(path, 'utf8')),
    ...focusedPaths.map((path) => readFileSync(path, 'utf8'))]
  const dictionary: string[] = []
  for (const name of readdirSync('v2/data').sort()) {
    if (!name.endsWith('.json')) continue
    strings(JSON.parse(readFileSync(join('v2/data', name), 'utf8')) as unknown, dictionary)
  }
  return { documents, dictionary: [...new Set(dictionary)], focused: focusedPaths.map((path) => readFileSync(path, 'utf8')) }
}

const CHARS = [' ', '\t', '\n', '\r', '\r\n', '\u00a0', '\u2028', '\u2029', '\ufeff', '\u200b', '\u200d',
  '\u0301', '\ud800', '\udc00', '\u202e', '\u2066', '\u2069', '\0', '#', '-', '*', '[', ']', '(', ')', '{', '}',
  '`', ':', '|', '<', '>', '&', '\\', '!', '/', '%', '^', '=']

function codepoint(rng: Random): string {
  if (rng.int(3) === 0) return CHARS[rng.int(CHARS.length)] ?? 'a'
  if (rng.int(3) === 0) return String.fromCharCode(32 + rng.int(95))
  return String.fromCodePoint(rng.int(0x110000))
}

function raw(rng: Random, maxBytes: number): string {
  const length = rng.int(Math.min(maxBytes, 4096) + 1)
  if (rng.bool()) {
    const bytes = Uint8Array.from({ length }, () => rng.int(256))
    return new TextDecoder().decode(bytes)
  }
  let output = ''
  for (let at = 0; at < length; at++) output += codepoint(rng)
  return output
}

function chunk(text: string, rng: Random): string {
  const start = rng.int(text.length + 1)
  return text.slice(start, start + 1 + rng.int(Math.min(100, text.length - start + 1)))
}

function mutateBytes(base: string, other: string, rng: Random): string {
  const bytes = Buffer.from(base)
  const at = rng.int(bytes.length + 1)
  const end = Math.min(bytes.length, at + 1 + rng.int(20))
  const prefix = bytes.subarray(0, at)
  const suffix = bytes.subarray(end)
  switch (rng.int(5)) {
    case 0: return Buffer.concat([prefix, Buffer.from([rng.int(256)]), bytes.subarray(at)]).toString('utf8')
    case 1: return Buffer.concat([prefix, suffix]).toString('utf8')
    case 2: return Buffer.concat([prefix, bytes.subarray(at, end), bytes.subarray(at, end), suffix]).toString('utf8')
    case 3: return Buffer.concat([prefix, Buffer.from(other).subarray(0, 50), suffix]).toString('utf8')
    default: {
      const swapped = Buffer.from(bytes)
      const left = rng.int(swapped.length)
      const right = rng.int(swapped.length)
      const old = swapped[left] ?? 0
      swapped[left] = swapped[right] ?? 0
      swapped[right] = old
      return swapped.toString('utf8')
    }
  }
}

function mutateLines(base: string, rng: Random): string {
  const lines = base.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  const at = rng.int(lines.length)
  const other = rng.int(lines.length)
  switch (rng.int(6)) {
    case 0: lines.splice(at, 0, lines[at] ?? ''); break
    case 1: lines.splice(at, 1); break
    case 2: [lines[at], lines[other]] = [lines[other] ?? '', lines[at] ?? '']; break
    case 3: lines[at] = codepoint(rng); break
    case 4: return lines.map((line) => `${rng.bool() ? '>' : '-'} ${line}`).join('\n')
    default: return lines.map((line) => rng.bool() ? `  ${line}` : line.startsWith('  ') ? line.slice(2) : line).join('\n')
  }
  return lines.join('\n')
}

function mutateBlocks(base: string, other: string, rng: Random): string {
  const part = chunk(base, rng)
  switch (rng.int(6)) {
    case 0: return `\`\`\`\n${base}\n\`\`\``
    case 1: return `::: note\n${base}\n:::`
    case 2: return base + '\n\n' + other
    case 3: return part.repeat(1 + rng.int(10_000))
    case 4: return base.replace(part, `${part}\n\n${part}`)
    default: return `${base}\n${chunk(other, rng)}\n${base}`
  }
}

function mutate(base: string, other: string, rng: Random): string {
  switch (rng.int(3)) {
    case 0: return mutateBytes(base, other, rng)
    case 1: return mutateLines(base, rng)
    default: return mutateBlocks(base, other, rng)
  }
}

function grammar(rng: Random, maxBytes: number): string {
  const lines: string[] = []
  const count = 1 + rng.int(200)
  const nest = rng.int(251)
  for (let at = 0; at < count; at++) {
    const prefix = at < nest ? '> '.repeat(nest) : ''
    const shape = LINE_SHAPES[rng.int(LINE_SHAPES.length)] ?? 'a'
    const tokens = Array.from({ length: rng.int(201) }, () => WRITER_TOKENS[rng.int(WRITER_TOKENS.length)] ?? 'a').join('')
    lines.push(prefix + shape + tokens)
    if (lines.join('\n').length > maxBytes) break
  }
  return lines.join('\n')
}

export function generate(rng: Random, corpus: Corpus, maxBytes: number): string {
  const base = corpus.documents[rng.int(corpus.documents.length)] ?? ''
  const other = corpus.documents[rng.int(corpus.documents.length)] ?? ''
  let value: string
  if (corpus.focused.length > 0 && rng.int(16) === 0) value = corpus.focused[rng.int(corpus.focused.length)] ?? ''
  else switch (rng.int(4)) {
    case 0: value = raw(rng, maxBytes); break
    case 1: value = mutate(base, other, rng); break
    case 2: value = grammar(rng, maxBytes); break
    default: {
      const word = corpus.dictionary[rng.int(corpus.dictionary.length)] ?? ':::'
      const at = rng.int(base.length + 1)
      value = base.slice(0, at) + word + base.slice(at)
    }
  }
  if (Buffer.byteLength(value) <= maxBytes) return value
  let clipped = Buffer.from(value).subarray(0, maxBytes).toString('utf8')
  while (Buffer.byteLength(clipped) > maxBytes) clipped = clipped.slice(0, -1)
  return clipped
}

function jsonValue(rng: Random, depth: number): unknown {
  const choice = rng.int(depth > 3 ? 4 : 6)
  if (choice === 0) return null
  if (choice === 1) return rng.bool()
  if (choice === 2) return rng.int(100000)
  if (choice === 3) return ['text', 'document', 'children', '\0', '2.0'][rng.int(5)]
  if (choice === 4) return Array.from({ length: rng.int(5) }, () => jsonValue(rng, depth + 1))
  const value: Record<string, unknown> = {}
  for (let at = 0; at < rng.int(5); at++) value[`key${rng.int(10)}`] = jsonValue(rng, depth + 1)
  return value
}

export function generateJson(rng: Random, legacy: boolean): string {
  if (!legacy) return rng.bool() ? JSON.stringify(jsonValue(rng, 0)) : generateTreeJson(rng)
  const children = Array.from({ length: rng.int(8) }, () => rng.bool() ?
    { type: 'paragraph', children: [{ type: 'text', value: String(jsonValue(rng, 0)) }] } :
    { type: 'heading', level: 1 + rng.int(6), children: [{ type: 'text', value: 'x' }] })
  const document: Record<string, unknown> = { type: 'document', astVersion: rng.bool() ? '1.2' : '0.2', children }
  if (rng.int(4) === 0) document['items'] = jsonValue(rng, 0)
  if (rng.int(4) === 0) document['children'] = jsonValue(rng, 0)
  return JSON.stringify(document)
}

function generateTreeJson(rng: Random): string {
  const text: Record<string, unknown> = { type: 'text', value: String(jsonValue(rng, 0)) }
  const paragraph: Record<string, unknown> = { type: 'paragraph', children: [text] }
  const document: Record<string, unknown> = { type: 'document', astVersion: '2.0', children: [paragraph] }
  if (rng.int(3) === 0) document['metadata'] = { title: [{ type: 'text', value: 'T' }], authors: ['A'],
    bibliography: { title: [{ type: 'text', value: 'Book' }], authors: ['A'], issued: '2026' },
    headers: [{ placement: 'first', children: [paragraph] }], fields: { note: { kind: 'string', value: 'x' } } }
  if (rng.int(3) === 0) document['resources'] = [{ id: 'r', mediaType: 'image/png',
    digest: `sha256:${'0'.repeat(64)}`, href: '/image.png', size: 3 }]
  if (rng.int(3) === 0) document['style'] = { page: { widthPt: 612, heightPt: 792,
    marginsPt: { top: 72, right: 72, bottom: 72, left: 72 } }, namedStyles: { body: { alignment: 'start' } } }
  switch (rng.int(5)) {
    case 0: text['value'] = jsonValue(rng, 0); break
    case 1: paragraph['children'] = jsonValue(rng, 0); break
    case 2: document['astVersion'] = jsonValue(rng, 0); break
    case 3: document['children'] = [paragraph, jsonValue(rng, 0)]; break
    default: break
  }
  return JSON.stringify(rng.int(4) === 0 ? { astVersion: rng.bool() ? '2.0' : '1.2',
    document, vocabulary: {}, extensions: [] } : document)
}
