import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('C2-T-019: a byte-input diagnostic uses original byte offsets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carve-cli-'))
  try {
    const path = join(dir, 'badutf.crv')
    writeFileSync(path, Buffer.from([0xff, 0x0a, 0x0a, 0x3a, 0x3a, 0x3a, 0x20, 0x66, 0x6f, 0x6f, 0x0a, 0x78]))
    const result = spawnSync(process.execPath, [join(import.meta.dirname, '../main.ts'), 'diagnostics', '--no-includes', path],
      { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`${path}:3:1: error unclosed-container-fence`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
