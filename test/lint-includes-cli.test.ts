import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { run, type CliIO } from '../src/cli.js'

function capture() {
  let stdout = ''
  let stderr = ''
  const io: CliIO = {
    readStdin: async () => '', readFile: p => readFileSync(p, 'utf8'), writeFile: (p, s) => writeFileSync(p, s),
    write: s => { stdout += s }, writeErr: s => { stderr += s },
  }
  return { io, output: () => stdout, errors: () => stderr }
}

describe('lint include CLI', () => {
  it('accepts a root cross-reference to an included heading in text and JSON output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-lint-crossref-'))
    try {
      const doc = join(dir, 'doc.crv')
      writeFileSync(doc, '# T\n\n{{ part.crv }}\n\nSee </#Inc>.\n')
      writeFileSync(join(dir, 'part.crv'), '# Inc\n\nBody.\n')
      for (const flags of [[], ['--json']]) {
        const result = capture()
        expect(await run(['lint', '--include-root', dir, ...flags, doc], result.io)).toBe(0)
        expect(flags.length ? JSON.parse(result.output()) : result.output()).toEqual(flags.length ? [] : '')
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('reports child payloads only with an explicit root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-lint-includes-'))
    try {
      mkdirSync(join(dir, 'data'))
      const doc = join(dir, 'doc.crv')
      writeFileSync(doc, '{table}\n{{ data/plans.csv @code:csv }}\n')
      writeFileSync(join(dir, 'data/plans.csv'), 'Plan,Seats,Price\nStarter,1,"$0"\nTeam,10,"$49" billed yearly\n')
      const text = capture()
      expect(await run(['lint', '--include-root', dir, doc], text.io)).toBe(1)
      expect(text.output()).toMatch(new RegExp(`^data/plans.csv:3:1 delimited-table-malformed.*\\(included from ${doc}:2:1\\)`, 'm'))
      const plain = capture()
      expect(await run(['lint', doc], plain.io)).toBe(0)
      expect(plain.output()).toBe('')
      const json = capture()
      expect(await run(['lint', '--include-root', dir, '--json', doc], json.io)).toBe(1)
      expect(JSON.parse(json.output())[0]).toMatchObject({ rule: 'delimited-table-malformed', file: 'data/plans.csv', line: 3, column: 1, includedBy: [{ file: doc, line: 2, column: 1 }] })
      const bad = capture()
      expect(await run(['lint', '--include-root', join(dir, 'missing'), doc], bad.io)).toBe(2)
      expect(bad.errors()).toContain('carve lint: cannot use include root')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
