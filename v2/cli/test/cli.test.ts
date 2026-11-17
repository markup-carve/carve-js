import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { CarveInputError, CarveLayoutError, CarveOptionError, CarveRenderError, CarveTreeError,
  CarveWriteError, render } from '../../src/index.ts'
import { FLAGS } from '../flags.ts'
import { classifyCliError } from '../run.ts'

const root = join(import.meta.dirname, '../../..')
const main = join(root, 'v2/cli/main.ts')
const dirs: string[] = []

function temp(): string {
  const path = mkdtempSync(join(tmpdir(), 'carve2-'))
  dirs.push(path)
  return path
}

function cli(args: string[], input = ''): { status: number | null, stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [main, ...args], { cwd: root, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('carve2 process', () => {
  it('C2-W-101 and C2-W-134 classify every public engine error type', () => {
    const cases = [
      [new CarveOptionError('mode', 'bad'), 'usage', 2],
      [new CarveInputError('minimal', 1), 'input-invalid', 2],
      [new CarveTreeError('/children', 'bad'), 'ast-json-invalid', 2],
      [new CarveLayoutError('/nodes', 'bad'), 'ast-json-invalid', 2],
      [new CarveRenderError([]), 'render-loss', 1],
      [new CarveWriteError([]), 'writer-refused', 1],
    ] as const
    for (const [error, category, status] of cases) {
      expect(classifyCliError(error)).toEqual({ category, status })
    }
  })
  it('C2-H-137: every flag is shown in its command help and the parser accepts its value', () => {
    for (const flag of FLAGS) {
      const value = flag.kind === 'boolean' ? '' : flag.kind === 'enum' ? `=${flag.values?.[0]}` : '={}'
      for (const command of flag.commands) {
        expect(cli([command, '--help']).stdout).toContain(`--${flag.name}`)
        if (flag.name === 'from-ast' || flag.name === 'write') continue
        const result = cli([command, `--${flag.name}${value}`, '--help'])
        expect(result.status, `${command} --${flag.name}`).toBe(0)
      }
    }
  })

  it('C2-W-101: unknown options, bad values, missing files and invalid AST JSON exit 2 with categories', () => {
    expect(cli(['--bad']).stderr).toMatch(/^carve\[usage\]:/)
    expect(cli(['--mode=broken']).stderr).toMatch(/^carve\[usage\]:/)
    expect(cli(['render', '/path/that/does/not/exist']).stderr).toMatch(/^carve\[input-unreadable\]:/)
    const invalid = cli(['fmt', '--from-ast'], '{')
    expect(invalid.status).toBe(2)
    expect(invalid.stderr).toMatch(/^carve\[ast-json-invalid\]:/)
  })

  it('C2-W-134: a writer refusal has its own category and failure status', () => {
    const result = cli(['fmt'], '\r')
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/^carve\[writer-refused\]:/)
  })

  it('C2-H-130: strict render loss has its own category and failure status', () => {
    const result = cli(['render', '--strict-losses'], '{{ e }}')
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/^carve\[render-loss\]:/)
  })

  it('C2-W-134: importing a writer refusal exits with a named category', () => {
    // C2-W-016: a CR directly before a line feed in a code value has no spelling.
    const result = cli(['import', '--from=djot'], '``` \na\r\nb\n```')
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/^carve\[writer-refused\]:/)
    expect(result.stderr).toMatch(/field-unspellable/)
  })

  it('C2-W-011, C2-M-083: an image-only paragraph and a denied destination import with output and status 0', () => {
    const image = cli(['import', '--from=html'], '<p><img src="a.png" alt="i"></p>\n')
    expect([image.status, image.stdout]).toEqual([0, '![i](a.png)\n'])
    const denied = cli(['import', '--from=html'], '<p><a href="javascript:x">t</a></p>\n')
    expect([denied.status, denied.stdout]).toEqual([0, 't\n'])
    expect(denied.stderr).toMatch(/^carve\[import-destination-denied\]:/)
  })

  it('C2-W-011: normalized Markdown imports return source and report degradation', () => {
    for (const input of ['line one\nline two\n', '```js\nlet a = 1\n```\n']) {
      const result = cli(['import', '--from=markdown'], input)
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(input)
      expect(result.stderr).toBe('')
    }
  })

  it('C2-W-007: paragraph-edge HTML line endings import without a writer refusal', () => {
    for (const [source, expected] of [['<p>\n  foo\n</p>', 'foo\n'], ['<h1>\n  Title\n</h1>', '= Title\n']]) {
      const result = cli(['import', '--from=html'], source)
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(expected)
      expect(result.stderr).toMatch(/^carve\[import-whitespace-normalized\]:/)
    }
  })

  it('C2-W-007: imported marker text stays visible through HTML normalization', () => {
    const preserved = cli(['import', '--from=html'], '- a\nx\n%%%\n- b')
    expect(preserved.status).toBe(0)
    expect(render(preserved.stdout)).toContain('- b')
    const normalized = cli(['import', '--from=html'], '\n- a\n b')
    expect(normalized.status).toBe(0)
    expect(normalized.stdout).toBe('\\- a\nb\n')
    expect(normalized.stderr).toMatch(/^carve\[import-whitespace-normalized\]:/)
  })

  it('C2-H-052: render uses stdin, explicit stdin, files, options and one raw HTML notice', () => {
    expect(cli([], 'hello').stdout).toBe('<p>hello</p>\n')
    expect(cli(['render', '-'], 'hello').stdout).toBe('<p>hello</p>\n')
    const dir = temp()
    const a = join(dir, 'a.crv')
    const b = join(dir, 'b.crv')
    writeFileSync(a, 'one')
    writeFileSync(b, 'two')
    expect(cli([a, b]).stdout).toBe('<p>one</p>\n<p>two</p>\n')
    const raw = 'a `<b>x</b>`{=html}'
    expect(cli(['render'], raw).stderr).toContain('--raw-html')
    expect(cli(['render', '--raw-html'], raw).stderr).toBe('')
    expect(cli(['render', '--no-sections'], '# Title').stdout).toContain('<h1')
    writeFileSync(a, raw)
    writeFileSync(b, raw)
    expect(cli(['render', a, b]).stderr.trim().split('\n')).toHaveLength(1)
  })

  it('C2-H-137: all render option values pass through the command line', () => {
    const flags = ['--heading-ids=ascii', '--mode=static', '--profile=full', '--raw-html', '--roundtrip',
      '--sections', '--smart-typography', '--source-lines', '--strict-losses', '--labels={}', '--symbols={}',
      '--social={}', '--url-policy={"deny":["javascript"]}', '--renderers={}', '--extensions=[]', '--includes']
    const result = cli(['render', ...flags], 'a `<b>`{=html}')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('<p data-source-line="1">')
  })

  it('C2-A-012 and C2-W-102: AST JSON round trips through render and fmt', () => {
    const tree = cli(['ast', '--no-positions'], 'text').stdout
    expect(cli(['ast', '--positions'], 'text').stdout).toContain('"pos"')
    expect(JSON.parse(tree)).toMatchObject({ astVersion: '2.0', type: 'document' })
    expect(tree).not.toContain('"pos"')
    const envelope = cli(['ast', '--envelope'], 'text').stdout
    expect(JSON.parse(envelope)).toHaveProperty('document')
    expect(cli(['render', '--from-ast'], tree).stdout).toBe('<p>text</p>\n')
    expect(cli(['fmt', '--from-ast'], tree).stdout).toBe('text\n')
  })

  it('C2-W-100: canonical check exits 0; changed check and diff exit 1; write changes the file', () => {
    const dir = temp()
    const path = join(dir, 'text.crv')
    writeFileSync(path, 'a\n')
    expect(cli(['fmt', '--check', path]).status).toBe(0)
    writeFileSync(path, 'a   \n')
    const check = cli(['fmt', '--check', path])
    expect(check.status).toBe(1)
    expect(check.stdout).toBe(`${path}:1\n- a   \n+ a\n`)
    const diff = cli(['fmt', '--diff', path])
    expect(diff.status).toBe(1)
    expect(diff.stdout).toContain('@@ -1,1 +1,1 @@')
    expect(cli(['fmt', '-w', path]).status).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe('a\n')
    expect(cli(['fmt', '--normalize'], '::: >\nquoted\n:::\n').stdout).toBe('> quoted\n')
    expect(cli(['fmt', '--align-tables'], '| a | long |\n| xx | b |\n').stdout).toBe('| a  | long |\n| xx | b    |\n')
  })

  it('C2-A-172: diagnostics emits parse findings as text and JSON', () => {
    const source = '{#a}\nx\n\n{#a}\ny'
    const plain = cli(['diagnostics'], source)
    expect(plain.status).toBe(0)
    expect(plain.stdout).toMatch(/^<stdin>:4:1: warning duplicate-id /)
    const json = cli(['diagnostics', '--json'], source)
    expect(JSON.parse(json.stdout) as unknown).toMatchObject({ files: [{ diagnostics: [{ channel: 'parse' }] }] })
  })

  it('C2-W-100: upgrade invokes the rewrite engine, with check, JSON and write', () => {
    const dir = temp()
    const path = join(dir, 'old.crv')
    writeFileSync(path, 'Some text\n# Heading\n')
    expect(cli(['upgrade', '--check', path]).status).toBe(1)
    const report = cli(['upgrade', '--json', path])
    expect(JSON.parse(report.stdout) as unknown).toMatchObject({ engine01: '0.1.17', files: [{ records: [{ entry: 'U-001' }] }] })
    expect(report.stderr).toContain('U-079')
    expect(cli(['upgrade', '--force'], 'a').status).toBe(0)
    cli(['upgrade', '--write', path])
    expect(readFileSync(path, 'utf8')).toContain('Some text\n\n# Heading')
  })

  it('C2-W-101: version and command help exit 0', () => {
    expect(cli(['--version']).stdout).toMatch(/^0\.2\.0-dev\n$/)
    for (const command of ['render', 'ast', 'fmt', 'diagnostics', 'upgrade', 'migrate-ast', 'import']) {
      expect(cli([command, '--help']).status).toBe(0)
    }
    expect(cli(['--help']).stdout).toContain('migrate-ast, import')
  })

  it('C2-A-176: migrate-ast upgrades stored JSON and reports invalid input with status 2', () => {
    const old = JSON.stringify({ type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi' }] }] })
    const result = cli(['migrate-ast'], old)
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout) as unknown).toMatchObject({ astVersion: '2.0', children: [{ type: 'paragraph' }] })
    const invalid = cli(['migrate-ast'], '{')
    expect(invalid.status).toBe(2)
    expect(invalid.stderr).toMatch(/^carve\[ast-json-invalid\]:/)
  })

  it('C2-W-101: import accepts all four formats and rejects a missing or bad format', () => {
    for (const format of ['markdown', 'gfm', 'djot', 'html']) {
      const input = format === 'html' ? '<p>Hi</p>' : 'Hi\n'
      const result = cli(['import', `--from=${format}`], input)
      expect(result.status, `${format}: ${result.stderr}`).toBe(0)
      expect(result.stdout).toContain('Hi')
    }
    expect(cli(['import'], 'Hi').status).toBe(2)
    expect(cli(['import', '--from=other'], 'Hi').status).toBe(2)
    expect(cli(['import', '--from=markdown', '/path/that/does/not/exist']).status).toBe(2)
  })

  it('C2-B-218: a file that is not well-formed UTF-8 is read, and the tree counts its bytes', () => {
    const path = join(temp(), 'bad.crv')
    writeFileSync(path, Uint8Array.from([0x61, 0xff, 0x0a]))
    const tree = JSON.parse(cli(['ast', path]).stdout) as { srcByteLength: number, children: [{ pos: { endOffset: number } }] }
    expect([tree.srcByteLength, tree.children[0].pos.endOffset]).toEqual([3, 2])
    expect(cli(['render', path]).stdout).toBe('<p>a\ufffd</p>\n')
  })
})
