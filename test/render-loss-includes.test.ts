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

type Schema = {
  $defs: Record<string, { properties: Record<string, unknown>; required?: string[] }>
  properties: { losses: { items: { properties: Record<string, unknown>; dependentRequired: Record<string, string[]> } } }
}
const schema = JSON.parse(readFileSync(new URL('../spec/resources/render-loss-report.schema.json', import.meta.url), 'utf8')) as Schema

/** The pinned schema's rules for where a loss points: its fields, `pos`, and the include chain. */
function placementViolations(loss: Record<string, unknown>): string[] {
  const item = schema.properties.losses.items
  const out = Object.keys(loss).filter(key => !(key in item.properties)).map(key => `unknown ${key}`)
  for (const [key, needs] of Object.entries(item.dependentRequired)) {
    if (key in loss) out.push(...needs.filter(need => !(need in loss)).map(need => `${key} without ${need}`))
  }
  const pos = loss.pos as Record<string, unknown> | undefined
  if (pos) out.push(...Object.keys(pos).filter(key => !(key in schema.$defs.pos!.properties)).map(key => `pos.${key}`))
  if ('includedBy' in loss) {
    const sites = loss.includedBy as Array<Record<string, unknown>>
    if (!Array.isArray(sites) || sites.length === 0) out.push('empty includedBy')
    for (const site of sites ?? []) {
      const def = schema.$defs.includeSite!
      if (Object.keys(site).some(key => !(key in def.properties)) || def.required!.some(key => !(key in site))) out.push('includeSite shape')
    }
  }
  return out
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
        expect(placementViolations(loss)).toEqual([])
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
    for (const item of report.losses) expect(placementViolations(item as unknown as Record<string, unknown>)).toEqual([])
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
      expect(placementViolations(loss as unknown as Record<string, unknown>)).toEqual([])
    }
  })

  it('refuses the placements the pinned schema refuses', () => {
    const pos = { startLine: 2, endLine: 4, startColumn: 1, endColumn: 4 }
    const loss = { code: 'markdown-container-flattened', target: 'markdown', nodeType: 'block', message: 'm', pos }
    const site = { file: 'docs/d.crv', line: 3, column: 1 }
    expect(placementViolations({ ...loss, file: 'snippets/div.crv', includedBy: [site] })).toEqual([])
    expect(placementViolations({ ...loss, file: 'snippets/div.crv' })).not.toEqual([])
    expect(placementViolations({ ...loss, includedBy: [site] })).not.toEqual([])
    expect(placementViolations({ ...loss, file: 'snippets/div.crv', includedBy: [] })).not.toEqual([])
    expect(placementViolations({ ...loss, file: 'snippets/div.crv', includedBy: [{ file: 'docs/d.crv', line: 3 }] })).not.toEqual([])
    expect(placementViolations({ ...loss, pos: { ...pos, file: '/abs/snippets/div.crv' } })).not.toEqual([])
  })
})
