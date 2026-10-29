import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { run, type CliIO } from '../src/cli.js'
import { expandIncludes, parse, renderMarkdownWithReport, resolve, RenderLossError } from '../src/index.js'

function capture() {
  let output = ''
  let errors = ''
  const io: CliIO = {
    readStdin: async () => '', readFile: path => readFileSync(path, 'utf8'), writeFile: (path, text) => writeFileSync(path, text),
    write: text => { output += text }, writeErr: text => { errors += text },
  }
  return { io, output: () => output, errors: () => errors }
}

describe('render losses in included content', () => {
  it('prints the child location and reports a schema shaped loss', async () => {
    const root = mkdtempSync(join(tmpdir(), 'carve-render-loss-'))
    try {
      mkdirSync(join(root, 'snippets'))
      const doc = join(root, 'd.crv')
      writeFileSync(doc, 'Intro.\n\n{{ snippets/div.crv }}\n')
      writeFileSync(join(root, 'snippets/div.crv'), '{.box}\n:::\nx\n:::\n')
      const result = capture()
      expect(await run(['--md', '--include-root', root, doc, '--report-losses', '-'], result.io)).toBe(0)
      expect(result.errors()).toContain(`snippets/div.crv:2:1 markdown-container-flattened - Flattened a container into Markdown blocks (included from ${doc}:3:1)`)
      const report = JSON.parse(result.errors().slice(result.errors().indexOf('{'))) as { losses: Array<Record<string, unknown>> }
      expect(report.losses.length).toBeGreaterThan(0)
      for (const loss of report.losses) {
        expect(loss).toMatchObject({ file: 'snippets/div.crv', includedBy: [{ file: doc, line: 3, column: 1 }] })
        expect(loss.pos).not.toHaveProperty('file')
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('keeps nested chains and selected source lines in checked results and errors', () => {
    const files: Record<string, string> = {
      'b.crv': '{{ c.crv @lines:3-6 }}\n',
      'c.crv': 'before\n\n{.box}\n:::\nx\n:::\n',
    }
    const root = '{{ b.crv }}\n'
    const expanded = expandIncludes(parse(root, { positions: true }), root, { sourcePath: 'a.crv', resolve: path => files[path] ?? null })
    const doc = resolve(expanded.doc)
    const report = renderMarkdownWithReport(doc)
    const loss = report.losses.find(item => item.code === 'markdown-container-flattened')!
    expect(loss).toMatchObject({ file: 'c.crv', pos: { startLine: 4 }, includedBy: [{ file: 'a.crv', line: 1, column: 1 }, { file: 'b.crv', line: 1, column: 1 }] })
    expect(loss.pos).not.toHaveProperty('file')
    let thrown: unknown
    try { renderMarkdownWithReport(doc, { strictLosses: true }) } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(RenderLossError)
    expect((thrown as RenderLossError).losses).toEqual(report.losses)
  })

  it('leaves top level losses without include fields', () => {
    const report = renderMarkdownWithReport(resolve(parse(':::\nx\n:::\n', { positions: true })))
    expect(report.losses.length).toBeGreaterThan(0)
    for (const loss of report.losses) {
      expect(loss).not.toHaveProperty('file')
      expect(loss).not.toHaveProperty('includedBy')
      expect(loss.pos).not.toHaveProperty('file')
    }
  })
})
