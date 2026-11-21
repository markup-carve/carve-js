import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CarveWriteError, type DocumentNode, type ExtensionDefinition, format, formatWithDiagnostics, parse,
  tabsExtensions, write } from '../src/index.ts'
import { checkGates } from '../test/support/writer-checks.ts'
import { check } from './check.ts'
import { random } from './generate.ts'

function optionRandom(name: string): { int(limit: number): number, bool(): boolean } {
  const data = JSON.parse(readFileSync(join(import.meta.dirname, '../data/options.json'), 'utf8')) as { options: { name: string }[] }
  const index = data.options.findIndex((entry) => entry.name === name)
  assert.notEqual(index, -1)
  return { int(limit) { assert.equal(limit, data.options.length); return index }, bool() { return true } }
}

void test('C2-W-022: an empty document has one final line feed', () => {
  assert.equal(format(''), '\n')
  assert.equal(check('format', '', random(1)), null)
})

void test('C2-A-167: the saved inline import case does not return an invalid tree', () => {
  const source = readFileSync(join(import.meta.dirname, 'regressions/import-inline-timeout.crv'), 'utf8')
  assert.equal(check('import', source, random(1286657655)), null)
})

void test('C2-H-130: strict losses may reject a document while accepting the option', () => {
  assert.equal(check('render', '{{ e }}', optionRandom('strictLosses')), null)
})

void test('C2-H-128: a host URL policy can permit a URL denied by the default', () => {
  assert.equal(check('render', '[](data:)', optionRandom('urlPolicy')), null)
})

void test('C2-H-002: href text inside a quoted attribute is not an href attribute', () => {
  assert.equal(check('render', '`L`HTML\n\n*[HTML]: H href=h', random(762805509)), null)
})

void test('C2-W-022: fmt --check recognizes an empty file as noncanonical', () => {
  const directory = mkdtempSync(join(tmpdir(), 'carve-empty-'))
  try {
    const path = join(directory, 'empty.crv')
    writeFileSync(path, '')
    const result = spawnSync(process.execPath, ['cli/main.ts', 'fmt', '--check', path], {
      cwd: join(import.meta.dirname, '..'), encoding: 'utf8',
    })
    assert.equal(result.status, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test('C2-W-088: needless bracket and brace escapes are removed', () => {
  for (const source of [String.raw`x[[^](/u)`, String.raw`x:n[[^](/u)`, String.raw`x{#a\_}`, String.raw`x{#a\_-}`]) {
    assert.equal(format(source), `${source}\n`)
  }
})

void test('C2-W-125: ordered repairs keep required bracket and brace escapes', () => {
  const cases: readonly (readonly [string, string])[] = [
    // C2-I-017: the backtick behind the escaped one has no closer, so the footnote closes at the bracket.
    ['x^[\\`a`]', 'x^[\\`a`]\n'],
    ['x{#a\\--}', 'x\\{#a-\\-}\n'],
    ['x{#\\---}', 'x\\{#\\---}\n'],
    ['x<a:b>{#\\--}', 'x<a:b>\\{#-\\-}\n'],
    ['x`a`{#\\--}', 'x`a`\\{#-\\-}\n'],
  ]
  for (const [source, expected] of cases) assert.equal(format(source), expected)
})

void test('C2-W-088: an escape before a dash run is removed when unasked', () => {
  const cases = ['x[----\\--', 'x^[----\\--------', 'x[\\[----\\--', 'x[-----\\---*a', 'x[----\\--a<a:b>']
  for (const source of cases) assert.equal(format(source), `${source.replace('\\[', '[')}\n`)
})

void test('C2-W-088: a former repair cycle reaches its canonical form', () => {
  const source = readFileSync(join(import.meta.dirname, 'fixtures/writer-cycle.crv'), 'utf8')
  const output = formatWithDiagnostics(source)
  assert.deepEqual(output.diagnostics, [])
  assert.equal(format(source), output.source)
  assert.equal(write(parse(source)), output.source)
  assert.equal(checkGates(source).refused, false)
})

void test('C2-W-134: source-only writer calls refuse an unspellable field', () => {
  const source = '\r'
  assert.equal(formatWithDiagnostics(source).diagnostics[0]?.code, 'field-unspellable')
  assert.throws(() => format(source), (error: unknown) => error instanceof CarveWriteError &&
    error.diagnostics.some((entry) => entry.code === 'field-unspellable'))
  assert.throws(() => write(parse(source)), CarveWriteError)
})

void test('C2-W-134: a source-only write refuses an unspellable structure', () => {
  const document: DocumentNode = { type: 'document', astVersion: '2.0', children: [
    { type: 'paragraph', children: [] }, { type: 'paragraph', children: [{ type: 'text', value: 'x' }] },
  ] }
  assert.throws(() => write(document), (error: unknown) => error instanceof CarveWriteError &&
    error.diagnostics.some((entry) => entry.code === 'structure-unspellable'))
})

void test('C2-X-051, D2: a line comment consuming every closer makes the tabs claim spellable', () => {
  const body = readFileSync(join(import.meta.dirname, '../test/fixtures/plan-quote-depth.crv'), 'utf8').trimEnd()
  const source = `:::: tabs\n::: tab "One"\n${body}\n:::\n::::\n`
  const result = formatWithDiagnostics(source, { extensions: tabsExtensions })
  assert.deepEqual(result.diagnostics, [])
  assert.equal(format(source, { extensions: tabsExtensions }), result.source)
  assert.equal(parse(source, { extensions: tabsExtensions }).children[0]?.type, 'block_extension')
})

void test('C2-X-051: a failed claim retains its core div and reports the extension', () => {
  const broken: ExtensionDefinition = { name: 'ex.throw', version: '1', matcher: { form: 'div', name: 'box' },
    props: {}, children: 'none', slots: {}, transform() { throw new Error('broken') } }
  const source = '::: box\nx\n:::\n'
  const result = formatWithDiagnostics(source, { extensions: [broken] })
  assert.equal(result.diagnostics.some((entry) => entry.code === 'extension-transform-failed' &&
    entry.message.includes('ex.throw')), true)
  assert.equal(parse(source, { extensions: [broken] }).children[0]?.type, 'div')
})

void test('C2-X-051: a lossy tabs claim keeps its core fallback', () => {
  assert.equal(check('extensions', '\r\r', random(1902500671)), null)
})

void test('C2-W-007: a space in an image alt value is content', () => {
  assert.equal(check('format', '![ \n`a`]()', random(1)), null)
})

void test('C2-W-011: an unspellable field is reported before checking stability', () => {
  assert.equal(check('format', '\r', random(1))?.kind, 'writer-accounting')
})

void test('C2-W-088: a formerly lost structure reads back after the round repairs its constructs', () => {
  assert.equal(check('format', 'x{/^[/}@\\`\\]\\`"\'', random(1)), null)
})

void test('C2-W-066: a bare CSV cell whose value is a space is valid', () => {
  assert.equal(check('format', '{table}\n```csv\n \n`', random(1)), null)
})

void test('C2-W-080: a hard break keeps text before it in a hard-break block', () => {
  assert.equal(check('format', '::: \\\n: \\\nt', random(1)), null)
})
