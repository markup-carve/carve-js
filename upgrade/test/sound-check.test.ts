import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import measured from '../data/measured-reports.json' with { type: 'json' }
import measuredReal from './measured-real.json' with { type: 'json' }
import contract from './contract.json' with { type: 'json' }
import { canWriteUpgrade, needsAttention, upgrade } from '../src/index.ts'
import { compareHtmlExact } from '../src/compare.ts'
import { matchMeasured } from '../src/measured-matchers.ts'

const unrelated = '~~~ js "a`b"\nx\n~~~\n'
const crlfCases = contract.flatMap((entry) => entry.inputs.map((input, index) => ({ entry: entry.id, input, index })))
  .concat(measuredReal.filter((item) => !item.input.includes('\r'))
    .map((item, index) => ({ entry: item.entries[0] ?? 'measured', input: item.input, index })))

describe('C2-W-100: the upgrade self-check', () => {
  it('keeps the review mismatch visible beside a raw HTML report', () => {
    const input = 'Some text\n# Heading\n\na `<b>x</b>`{=html} b\n\n' + unrelated
    const result = upgrade(input)
    expect(result.records.map((record) => record.entry)).toContain('U-077')
    expect(result.check).toBe('mismatch')
    expect(canWriteUpgrade(result)).toBe(false)
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it.each(measured)('C2-W-100: $id shape cannot hide an independent fence difference', ({ id, input }) => {
    const variants = [upgrade(unrelated + '\n' + input), upgrade(input + '\n' + unrelated)]
    const cited = variants.find((item) => item.records.some((record) => record.entry === id))
    if (!['U-145', 'U-148', 'U-154', 'U-251', 'U-252'].includes(id)) expect(cited).toBeDefined()
    const result = cited ?? variants[0]
    expect(result?.check).toBe('mismatch')
    expect(result?.records.some((record) => record.entry === 'upgrade-mismatch')).toBe(true)
  })

  it.each([
    ['U-145', '/*//', '<em>x</em>', 'x'],
    ['U-148', '# title ][', 'x', 'y'],
    ['U-154', '^[ [^1]]\n[^1]: n', '<sup>', 'role="doc-noteref"'],
    ['U-251', '[^n]: - [ ]  [^f]: x\n\nr[^n] [^f]\n', 'class="task-list"', 'class="task"'],
    ['U-252', '- [x]   - :: term\n           : desc\n', '<dl>', '<dt>term\n: desc'],
  ])('C2-W-100: %s matcher is not proof of an unrelated HTML difference', (id, input, old, next) => {
    expect(matchMeasured(input, old, next)).toBe(id)
    expect(upgrade(input + '\n' + unrelated).check).toBe('mismatch')
  })

  it('C2-W-100: the write gate preserves the file when a named report leaves a mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-check-'))
    try {
      const file = join(dir, 'case.crv')
      const input = 'Some text\n# Heading\n\na `<b>x</b>`{=html} b\n\n' + unrelated
      writeFileSync(file, input)
      spawnSync(process.execPath, [join(import.meta.dirname, '../src/cli.ts'), '--write', file])
      expect(readFileSync(file, 'utf8')).toBe(input)
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('C2-W-100: a rewrite with no HTML effect on either engine leaves the source alone', () => {
    const input = '* [d]: \n text\n'
    const result = upgrade(input)
    expect(result.output).toBe(input)
    expect(result.records.map((record) => record.entry)).not.toContain('U-109')
  })

  it('C2-B-105: a needless brace-tail edit is reported without rewriting', () => {
    const input = '```js {.x}\na\n```\n'
    const result = upgrade(input)
    expect(result.output).toBe(input)
    expect(result.records.find((record) => record.entry === 'U-037')?.class).toBe('none')
  })

  it('C2-W-100: a redundant entry is removed while a useful neighboring edit stays', () => {
    const result = upgrade('> q\n> {.k}\n\ntail\n')
    expect(result.records.map((record) => record.entry)).toContain('U-003')
    expect(result.records.map((record) => record.entry)).not.toContain('U-031')
    expect(result.check).toBe('pass')
  })

  it('C2-B-056: U-023 uses the general marker-column lint for a bullet', () => {
    const result = upgrade('- a\n - b\n')
    expect(result.records.find((record) => record.entry === 'U-023')?.lint).toBe('list-marker-below-content-column')
  })

  it('C2-W-100: a rescue discards stale first-pass explanation classes', () => {
    const plain = upgrade('- {{ e }}')
    expect(plain.check).toBe('pass')
    expect(needsAttention(plain)).toBe(false)
    expect(plain.records.some((record) => record.class === 'unverified explanation')).toBe(false)
    const cited = upgrade('[a][a]{.c}{#i}\n')
    expect(cited.check).toBe('explained')
    expect(cited.records.find((record) => record.entry === 'U-036')?.class).toBe('report')
  })

  it('C2-W-100: a pass or verified transformation clears the library write gate', () => {
    expect(canWriteUpgrade(upgrade('plain\n'))).toBe(true)
    expect(canWriteUpgrade(upgrade('- item\n\n  ***\n'))).toBe(true)
  })

  it('C2-H-088: U-154 verifies the note mark moved after its containing link', () => {
    for (const input of ['a [t^[n]](/u) b\n', 'a [link^[note]](/url) b\n']) {
      const result = upgrade(input)
      expect(result.check).toBe('explained')
      expect(result.records.map((record) => record.entry)).toContain('U-154')
    }
  })

  it('C2-I-068: a wrapped link title has no local HTML transformation', () => {
    const result = upgrade('[a](/u "t\nu")')
    expect(result.check).toBe('mismatch')
    expect(result.records.find((record) => record.entry === 'U-221')?.class).toBe('unverified explanation')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('C2-H-032: task class and generated style are real HTML differences', () => {
    expect(compareHtmlExact('<li>x</li>', '<li class="task" style="list-style: none">x</li>').equal).toBe(false)
  })

  it.each(['- [ ] x\n\n- a\n\n  c\n', '- a\n\n  c\n\n- [ ] x\n'])
  ('C2-H-032: task presentation verifies beside a loose one-item list in either order', (input) => {
    expect(upgrade(input).check).toBe('explained')
  })

  it('C2-B-062: U-021 removes only the first paragraph wrapper of a one-item list', () => {
    const result = upgrade('- a\n\n  c\n')
    expect(result.check).toBe('explained')
    expect(result.records.map((record) => record.entry)).toContain('U-021')
  })

  it('C2-W-101: invalid UTF-8 is an input error and leaves the bytes unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-utf8-'))
    try {
      const file = join(dir, 'case.crv')
      const bytes = Buffer.from([0x61, 0xff, 0x0a, 0x23, 0x20, 0x48, 0x0a])
      writeFileSync(file, bytes)
      const done = spawnSync(process.execPath, [join(import.meta.dirname, '../src/cli.ts'), '--write', file])
      expect(done.status).toBe(2)
      expect(done.stderr.toString()).toMatch(/^carve\[input-unreadable\]:/)
      expect(readFileSync(file)).toEqual(bytes)
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('C2-W-101: an unreadable file has the command-line input status without a stack trace', () => {
    const missing = join(tmpdir(), 'carve-upgrade-no-such-file.crv')
    const done = spawnSync(process.execPath, [join(import.meta.dirname, '../src/cli.ts'), missing])
    expect(done.status).toBe(2)
    expect(done.stderr.toString()).toMatch(/^carve\[input-unreadable\]:/)
    expect(done.stderr.toString()).not.toContain('\n    at ')
  })

  it('C2-W-101: a UTF-8 BOM survives a write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-bom-'))
    try {
      const file = join(dir, 'case.crv')
      writeFileSync(file, Buffer.from('\ufeff\n```js{1,3}\na\n```\n'))
      const done = spawnSync(process.execPath, [join(import.meta.dirname, '../src/cli.ts'), '--write', file])
      expect(done.status).toBe(0)
      expect(readFileSync(file).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
      expect(readFileSync(file, 'utf8')).toContain('```js\na\n```')
    } finally { rmSync(dir, { recursive: true }) }
  })

  it.each(['{loose}\n- a\n- b\n', 'i) one\nj) two\n', '```js{1,3}\na\n```\n'])
  ('C2-W-101: a BOM on the opener line stays at the start of the rewrite', (input) => {
    const plain = upgrade(input)
    const withBom = upgrade('\ufeff' + input)
    expect(withBom.output).toBe('\ufeff' + plain.output)
    expect(withBom.check).toBe(plain.check)
  })

  it('C2-W-101: an unreadable later file prevents earlier writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-atomic-'))
    try {
      const file = join(dir, 'case.crv')
      const input = '```js{1,3}\na\n```\n'
      writeFileSync(file, input)
      const done = spawnSync(process.execPath,
        [join(import.meta.dirname, '../src/cli.ts'), '--write', file, join(dir, 'missing.crv')])
      expect(done.status).toBe(2)
      expect(readFileSync(file, 'utf8')).toBe(input)
    } finally { rmSync(dir, { recursive: true }) }
  })

  it.each(crlfCases)('C2-W-100: $entry#$index keeps CRLF when a rule inserts a line break', ({ input }) => {
    const crlf = input.replaceAll('\n', '\r\n')
    const result = upgrade(crlf)
    const lf = upgrade(input)
    expect(result.check).toBe(lf.check)
    expect(result.output.replaceAll('\r\n', '\n')).toBe(lf.output)
    if (result.changed && result.output.includes('\n')) expect(result.output).not.toMatch(/(?<!\r)\n/)
  })

  it('C2-W-100: a quote continuation has the same rewrite with either line ending', () => {
    const lf = upgrade('> +\n>')
    const crlf = upgrade('> +\r\n>')
    expect(crlf.check).toBe(lf.check)
    expect(crlf.output).toBe(lf.output.replaceAll('\n', '\r\n'))
  })
})
