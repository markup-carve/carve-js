import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lint, prepareLint, renderWithDiagnostics } from '../src/index.ts'
import { type ExtensionDefinition } from '../src/extensions/types.ts'

// carve-js#5776, C2-T-031: lint returns the parse and lint channels; the render losses of a claim belong to render.
const failing: ExtensionDefinition = { name: 'host.box', version: '1', matcher: { form: 'div', name: 'box' }, props: {},
  slots: {}, children: 'none', transform: () => { throw new Error('boom') } }
const source = '::: box\nY\n:::\n'

describe('lint and the render losses of a parse', () => {
  it('returns no render-loss entry when a host transform throws', () => {
    expect(renderWithDiagnostics(source, { extensions: [failing] }).diagnostics.map((entry) => entry.code))
      .toContain('extension-transform-failed')
    expect(lint(source, { extensions: [failing] })).toEqual([])
    expect(lint(prepareLint(source, { extensions: [failing] }))).toEqual([])
  })

  it('keeps the parse channel', () => {
    const codes = lint('```\nopen\n', { extensions: [failing] }).map((entry) => entry.channel)
    expect(codes).toContain('parse')
  })

  it('ends the CLI lint run with status 0', () => {
    const root = join(import.meta.dirname, '..')
    const result = spawnSync(process.execPath, [join(root, 'cli/main.ts'), 'lint', '--json', '--extensions',
      '["carve.details","carve.wiki"]', '-'], { cwd: root, input: '::: details "X"\nY :wiki[Z].\n:::\n', encoding: 'utf8' })
    const report = JSON.parse(result.stdout) as { files: { diagnostics: unknown[] }[] }
    expect(report.files[0]?.diagnostics).toEqual([])
    expect(result.status).toBe(0)
  })
})
