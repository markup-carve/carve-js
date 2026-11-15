import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const standalone = join(import.meta.dirname, '../src/cli.ts')
const carve2 = join(import.meta.dirname, '../../v2/cli/main.ts')

function run(file: string, integrated: boolean): ReturnType<typeof spawnSync> {
  const args = integrated ? [carve2, 'upgrade', '--json', file] : [standalone, '--json', file]
  return spawnSync(process.execPath, args)
}

describe('C2-W-100: upgrade command record and exit parity', () => {
  it.each([
    ['plain', 'text\n'],
    ['rewrite', '```js{1,3}\na\n```\n'],
    ['difference', 'a [link^[note]](/url) b\n~~~ js "a`b"\nx\n~~~\n'],
  ])('C2-W-100: %s has the same JSON and status as carve2', (_name, input) => {
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

  it('C2-W-101: invalid UTF-8 has the same categorized status as carve2', () => {
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
