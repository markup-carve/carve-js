import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CarveWriteError, format, formatWithDiagnostics, parse, write } from '../src/index.ts'
import { checkGates, checkWriter } from '../test/support/writer-checks.ts'
import { check } from './check.ts'
import { random } from './generate.ts'

void test('C2-W-022: an empty document has one final line feed', () => {
  assert.equal(format(''), '\n')
  assert.equal(check('format', '', random(1)), null)
})

void test('C2-W-022: fmt --check recognizes an empty file as noncanonical', () => {
  const directory = mkdtempSync(join(tmpdir(), 'carve-empty-'))
  try {
    const path = join(directory, 'empty.crv')
    writeFileSync(path, '')
    const result = spawnSync(process.execPath, ['v2/cli/main.ts', 'fmt', '--check', path], {
      cwd: join(import.meta.dirname, '../..'), encoding: 'utf8',
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
    ['x^[\\`a`]', 'x^\\[\\`a`]`\n'],
    ['x{#a\\--}', 'x\\{#a-\\-}\n'],
    ['x{#\\---}', 'x\\{#\\---}\n'],
    ['x<a:b>{#\\--}', 'x<a:b>\\{#-\\-}\n'],
    ['x`a`{#\\--}', 'x`a`\\{#-\\-}\n'],
  ]
  for (const [source, expected] of cases) assert.equal(format(source), expected)
})

void test('C2-W-133: a repeated writer repair state is reported', () => {
  const source = readFileSync(join(import.meta.dirname, 'fixtures/writer-cycle.crv'), 'utf8')
  const script = 'const r = require("./v2/src/index.ts").formatWithDiagnostics(process.env.CARVE_SOURCE);' +
    'process.stdout.write(JSON.stringify(r.diagnostics.map((entry) => entry.code)))'
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: join(import.meta.dirname, '../..'), encoding: 'utf8', timeout: 2000,
    env: { ...process.env, CARVE_SOURCE: source },
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /writer-refused/)
  const diagnostic = formatWithDiagnostics(source).diagnostics.find((entry) => entry.code === 'writer-refused')
  assert.equal(diagnostic?.path, '/children/0')
  assert.throws(() => format(source), CarveWriteError)
  assert.throws(() => write(parse(source)), CarveWriteError)
  assert.equal(checkWriter(source), 'refused')
  assert.equal(checkGates(source).refused, true)
})

void test('C2-W-007: a space in an image alt value is content', () => {
  assert.equal(check('format', '![ \n`a`]()', random(1)), null)
})

void test('C2-W-011: an unspellable field is reported before checking stability', () => {
  assert.equal(check('format', '\r', random(1))?.kind, 'writer-accounting')
})

void test('C2-W-011: an unspellable structure is reported before checking stability', () => {
  assert.equal(check('format', '/\\{*\\`*/', random(1))?.kind, 'writer-accounting')
})
