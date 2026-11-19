// `carve render --to markdown|plain|ansi`: the exports of `@markup-carve/carve/export` behind the render command.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../..')
const main = join(root, 'cli/main.ts')

function cli(args: string[], input = ''): { status: number | null, stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [main, ...args], { cwd: root, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('render --to', () => {
  it('writes each export target', () => {
    expect(cli(['render', '--to', 'markdown'], '= T\n\n*b*\n').stdout).toBe('# T\n\n**b**\n')
    expect(cli(['render', '--to', 'plain'], '= T\n\n*b*\n').stdout).toBe('T\n\nb\n')
    expect(cli(['render', '--to', 'ansi'], '*b*\n').stdout).toBe('\x1b[1mb\x1b[0m\n')
    expect(cli(['render', '--to', 'html'], '*b*\n').stdout).toBe('<p><strong>b</strong></p>\n')
  })

  it('reports losses and fails under --strict-losses, and takes an export code in --allow-loss', () => {
    const lost = cli(['render', '--to', 'markdown', '--strict-losses'], '::: x\nz\n:::\n')
    expect(lost.status).toBe(1)
    expect(lost.stderr).toContain('markdown-container-flattened')
    const allowed = cli(['render', '--to', 'markdown', '--strict-losses', '--allow-loss', 'markdown-container-flattened'], '::: x\nz\n:::\n')
    expect(allowed).toMatchObject({ status: 0, stdout: 'z\n' })
  })

  it('writes the include report of an exported file', () => {
    const report = cli(['render', '--to', 'plain', '--report-includes', '-'], 'a\n')
    expect(report.status).toBe(0)
    expect(report.stderr).toContain('"file": "<stdin>"')
  })

  it('writes to --output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-export-'))
    const file = join(dir, 'out.md')
    expect(cli(['render', '--to', 'markdown', '--output', file], '*b*\n').status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe('**b**\n')
  })

  it('refuses a target it does not know', () => {
    const refused = cli(['render', '--to', 'pdf'], 'a\n')
    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain('bad value for --to: pdf')
  })
})
