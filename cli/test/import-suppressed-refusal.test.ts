import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

const main = join(import.meta.dirname, '../main.ts')

function cli(args: string[], input: string): { status: number | null, stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [main, 'import', '--from=html', ...args], { input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

it('C2-H-205, C2-W-134, C2-T-034: suppressed writer losses still refuse a source-only import', () => {
  const html = '<!--x-->'.repeat(101) + '<!doctype html><html lang="en" dir="ltr"><body><p>x</p></body></html>'
  const dir = mkdtempSync(join(tmpdir(), 'carve-import-loss-'))
  try {
    const path = join(dir, 'report.json')
    const result = cli(['--report-losses', path], html)
    expect([result.status, result.stdout]).toEqual([1, ''])
    expect(result.stderr).toMatch(/^carve\[writer-refused\]:/)
    const report = JSON.parse(readFileSync(path, 'utf8')) as {
      files: { diagnostics: { code: string }[], suppressed: number }[]
    }
    expect(report.files[0]?.diagnostics).toHaveLength(100)
    expect(report.files[0]?.diagnostics.every((entry) => entry.code === 'import-element-dropped')).toBe(true)
    expect(report.files[0]?.suppressed).toBe(4)

    const strict = cli(['--strict-losses', '--max-render-losses', '0'], html)
    expect([strict.status, strict.stdout]).toEqual([1, ''])
    expect(strict.stderr).toMatch(/^carve\[render-loss\]:/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('C2-T-025: allowed writer loss beyond the cap does not refuse the import', () => {
  const html = '<!--x-->'.repeat(101) + '<html lang="en"><body><p>x</p></body></html>'
  const result = cli(['--allow-loss', 'field-unspellable'], html)
  expect([result.status, result.stdout]).toEqual([0, 'x\n'])
})
