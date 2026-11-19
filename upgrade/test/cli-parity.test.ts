import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const standalone = join(import.meta.dirname, '../src/cli.ts')
const carveCli = join(import.meta.dirname, '../../cli/main.ts')

function run(file: string, integrated: boolean): ReturnType<typeof spawnSync> {
  const args = integrated ? [carveCli, 'upgrade', '--json', file] : [standalone, '--json', file]
  return spawnSync(process.execPath, args)
}

function writeRun(file: string, integrated: boolean, force = false): ReturnType<typeof spawnSync> {
  const args = integrated ? [carveCli, 'upgrade', '--write'] : [standalone, '--write']
  if (force) args.push('--force')
  return spawnSync(process.execPath, [...args, file])
}

describe('C2-W-100: upgrade command record and exit parity', () => {
  it('C2-W-100: force cannot write a mismatch through either command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-parity-'))
    try {
      const file = join(dir, 'case.crv')
      const bytes = Buffer.from('/***/\n\n{valigns=top,bottom widths=40}\n| a | b | c |\n')
      for (const integrated of [false, true]) {
        writeFileSync(file, bytes)
        const done = writeRun(file, integrated, true)
        expect(done.status).toBe(1)
        expect(readFileSync(file)).toEqual(bytes)
      }
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('C2-W-100: both commands preserve a BOM and CRLF while rewriting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-parity-'))
    try {
      const file = join(dir, 'case.crv')
      const bytes = Buffer.from('\ufeffSome text\r\n# Heading\r\n')
      for (const integrated of [false, true]) {
        writeFileSync(file, bytes)
        const done = writeRun(file, integrated)
        expect(done.status).toBe(0)
        const output = readFileSync(file).toString('utf8')
        expect(output.startsWith('\ufeff')).toBe(true)
        expect(output).toContain('\r\n')
        expect(output.replaceAll('\r\n', '\n')).not.toBe(bytes.toString('utf8').replaceAll('\r\n', '\n'))
      }
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('C2-W-101: malformed UTF-8 stays byte identical with write and force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-parity-'))
    try {
      const file = join(dir, 'case.crv')
      const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0xff])
      for (const integrated of [false, true]) {
        writeFileSync(file, bytes)
        const done = writeRun(file, integrated, true)
        expect(done.status).toBe(2)
        expect(readFileSync(file)).toEqual(bytes)
      }
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('C2-W-100: check and force have the same write-free behavior', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-parity-'))
    try {
      const file = join(dir, 'case.crv')
      const bytes = Buffer.from('/***/\n\n{valigns=top,bottom widths=40}\n| a | b | c |\n')
      writeFileSync(file, bytes)
      for (const integrated of [false, true]) {
        const args = integrated ? [carveCli, 'upgrade', '--check', '--force', file]
          : [standalone, '--check', '--force', file]
        const done = spawnSync(process.execPath, args)
        expect(done.status).toBe(1)
        expect(done.stderr.toString()).not.toContain('upgrade-force-ignored')
        expect(readFileSync(file)).toEqual(bytes)
      }
    } finally { rmSync(dir, { recursive: true }) }
  })
  it.each([
    ['plain', 'text\n'],
    ['rewrite', '```js{1,3}\na\n```\n'],
    ['difference', 'a [link^[note]](/url) b\n~~~ js "a`b"\nx\n~~~\n'],
  ])('C2-W-100: %s has the same JSON and status as carve', (_name, input) => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-parity-'))
    try {
      const file = join(dir, 'case.crv')
      writeFileSync(file, input)
      const direct = run(file, false)
      const throughCarve2 = run(file, true)
      expect(direct.status).toBe(throughCarve2.status)
      expect(JSON.parse(direct.stdout.toString())).toEqual(JSON.parse(throughCarve2.stdout.toString()))
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('C2-W-101: invalid UTF-8 has the same categorized status as carve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-upgrade-parity-'))
    try {
      const file = join(dir, 'case.crv')
      const bytes = Buffer.from([0xff, 0x0a])
      writeFileSync(file, bytes)
      for (const integrated of [false, true]) {
        const done = run(file, integrated)
        expect(done.status).toBe(2)
        expect(done.stderr.toString()).toMatch(/^carve\[input-unreadable\]:/)
        expect(readFileSync(file)).toEqual(bytes)
      }
    } finally { rmSync(dir, { recursive: true }) }
  })
})
