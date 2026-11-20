// The command line expands includes by default, with the directory of the entry file as containment root (C2-N-004,
// C2-N-012 to C2-N-014), and the file resolver keeps every target inside that root.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { render, renderWithDiagnostics } from '../../src/index.ts'
import { INCLUDE_BYTES } from '../../src/include-tables.ts'
import { cliIncludes, fileResolver } from '../include-fs.ts'

const main = join(import.meta.dirname, '../main.ts')
const dirs: string[] = []

function tree(files: Readonly<Record<string, string>>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'carve-include-')))
  dirs.push(root)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

function cli(args: string[], cwd: string, input = ''): { status: number | null, stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [main, ...args], { cwd, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function codes(src: string, root: string, file?: string): string[] {
  const includes = { resolver: fileResolver(root), ...(file === undefined ? {} : { file }) }
  return renderWithDiagnostics(src, { includes }).diagnostics.map((entry) => entry.code)
}

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('the file resolver', () => {
  it('C2-N-012, C2-N-014: a .. path inside the root resolves; one out of it is outside_root, also when nothing is there', () => {
    const root = tree({ 'book/main.crv': '', 'book/chapters/one.crv': '{{ ../shared/glossary.crv }}\n', 'book/shared/glossary.crv': 'Gloss.\n' })
    const book = join(root, 'book')
    expect(render('{{ chapters/one.crv }}', { includes: { resolver: fileResolver(book), file: 'main.crv' } })).toBe('<p>Gloss.</p>')
    expect(codes('{{ ../../etc/passwd }}', book, 'chapters/one.crv')[0]).toBe('include-outside-root')
    expect(codes('{{ ../../no/such/file }}', book, 'chapters/one.crv')[0]).toBe('include-outside-root')
    expect(codes('{{ nothing.crv }}', book, 'main.crv')[0]).toBe('include-not-found')
  })

  it('C2-N-012: an absolute path is read only where it canonicalizes inside the root; a URI scheme is outside', () => {
    const root = tree({ 'in.crv': 'In.\n' })
    expect(render(`{{ ${join(root, 'in.crv')} }}`, { includes: fileResolver(root) })).toBe('<p>In.</p>')
    expect(codes('{{ /etc/hostname }}', root)[0]).toBe('include-outside-root')
    expect(codes('{{ https://example.org/a.crv }}', root)[0]).toBe('include-outside-root')
  })

  it('C2-N-012: a symbolic link inside the root to a file or a directory outside it is outside_root', () => {
    const outside = tree({ 'secret.crv': 'TOP SECRET\n' })
    const root = tree({ 'main.crv': '' })
    symlinkSync(join(outside, 'secret.crv'), join(root, 'link.crv'))
    symlinkSync(outside, join(root, 'linkdir'))
    expect(codes('{{ link.crv }}', root)[0]).toBe('include-outside-root')
    expect(codes('{{ linkdir/secret.crv }}', root)[0]).toBe('include-outside-root')
    expect(codes('{{ linkdir/missing.crv }}', root)[0]).toBe('include-outside-root')
    expect(JSON.stringify(renderWithDiagnostics('{{ link.crv }}', { includes: fileResolver(root) }))).not.toContain('SECRET')
  })

  it('C2-N-013: a directory swapped for a link to an outside directory between the test and the read is never read', () => {
    const outside = tree({ 'a.crv': 'TOP SECRET\n' })
    const root = tree({ 'inner/a.crv': 'Inner.\n' })
    const swap = (): void => {
      renameSync(join(root, 'inner'), join(root, 'moved'))
      symlinkSync(outside, join(root, 'inner'))
    }
    const output = renderWithDiagnostics('{{ inner/a.crv }}', { includes: fileResolver(root, { afterTest: swap }) })
    expect(JSON.stringify(output)).not.toContain('SECRET')
    expect(output.diagnostics.map((entry) => entry.code)[0]).toBe('include-outside-root')
  })

  it('C2-N-013: a file swapped for a link to an outside file after the test is not read', () => {
    const outside = tree({ 'secret.crv': 'TOP SECRET\n' })
    const root = tree({ 'a.crv': 'A.\n' })
    const swap = (): void => {
      symlinkSync(join(outside, 'secret.crv'), join(root, 'swapped'))
      renameSync(join(root, 'swapped'), join(root, 'a.crv'))
    }
    const output = renderWithDiagnostics('{{ a.crv }}', { includes: fileResolver(root, { afterTest: swap }) })
    expect(JSON.stringify(output)).not.toContain('SECRET')
  })

  it('C2-N-065: a file past the size cap is refused with include-budget, not as unreadable', () => {
    const root = tree({ 'big.crv': 'é'.repeat(INCLUDE_BYTES / 2 + 1), 'small.crv': 'S.\n' })
    expect(codes('{{ big.crv }}\n\n{{ small.crv }}', root)).toEqual(['include-budget', 'include-unresolved'])
    expect(render('{{ small.crv }}', { includes: fileResolver(root) })).toBe('<p>S.</p>')
  })

  it('C2-N-009: two spellings of one target give one id, so a cycle through them is found', () => {
    const root = tree({ 'a/b.crv': '{{ ./../a/./b.crv }}\n' })
    expect(codes('{{ a/./b.crv }}', root)).toEqual(['include-cycle', 'include-unresolved'])
  })

  it('C2-N-011, C2-N-013: a directory is unreadable, and bytes that are not UTF-8 are not text', () => {
    const root = tree({ 'dir/x.crv': '' })
    writeFileSync(join(root, 'bin'), Buffer.from([0x61, 0xff, 0x62]))
    expect(codes('{{ dir }}', root)[0]).toBe('include-unreadable')
    expect(codes('{{ bin }}', root)[0]).toBe('include-non-text')
  })

  it('C2-N-004: standard input has no default root', () => {
    expect(cliIncludes('-', undefined)).toBeNull()
    const root = tree({ 'a.crv': 'A\n' })
    expect(cliIncludes('-', root)?.file).toBeUndefined()
  })
})

describe('carve and includes', () => {
  it('lint names each included file and its outermost-first include sites in text and JSON', () => {
    const root = tree({
      'book/main.crv': '**top**\n\n{{ parts/a.crv }}\n\n{{ parts/a.crv }}\n',
      'book/parts/a.crv': 'ok\n**child**\n\n{{ nested/b.crv }}\n',
      'book/parts/nested/b.crv': 'before\n**nested**\n',
    })
    const text = cli(['lint', '--include-root', root, 'book/main.crv'], root)
    expect(text.status).toBe(1)
    expect(text.stdout).toContain('book/main.crv:1:1: warning markdown-strong-double-star')
    expect(text.stdout).toContain('book/parts/a.crv:2:1: warning markdown-strong-double-star')
    expect(text.stdout).toContain('(included from book/main.crv:3:1)')
    expect(text.stdout).toContain('parts/nested/b.crv:2:1: warning markdown-strong-double-star')
    expect(text.stdout).toContain('(included from book/main.crv:3:1 > book/parts/a.crv:4:1)')
    expect(text.stdout.split('\n')[0]).not.toContain('(included from')

    const json = cli(['lint', '--include-root', root, '--json', 'book/main.crv'], root)
    expect(json.status).toBe(1)
    const report = JSON.parse(json.stdout) as { files: { diagnostics: {
      code: string, file?: string, line?: number, column?: number,
      includedBy?: { file?: string, line: number, column: number }[]
    }[] }[] }
    const nested = report.files[0]!.diagnostics.find((entry) => entry.file === 'book/parts/nested/b.crv')!
    expect(nested).toMatchObject({ code: 'markdown-strong-double-star', line: 2, column: 1,
      includedBy: [{ line: 3, column: 1 }, { file: 'book/parts/a.crv', line: 4, column: 1 }] })
    expect(report.files[0]!.diagnostics.find((entry) => entry.file === undefined)!.includedBy).toBeUndefined()
  })

  it('C2-N-004: render expands by default from the directory of the entry file', () => {
    const root = tree({ 'book/main.crv': 'Top.\n\n{{ chapters/one.crv }}\n', 'book/chapters/one.crv': 'One.\n' })
    const result = cli(['render', 'book/main.crv'], root)
    expect(result.stdout).toBe('<p>Top.</p>\n<p>One.</p>\n')
    expect(result.status).toBe(0)
  })

  it('C2-N-010: the includes of an entry from standard input with a named root resolve against the root', () => {
    const root = tree({ 'sub/a.crv': 'A.\n', 'a.crv': 'Root A.\n' })
    const result = cli(['render', '--include-root', root, '-'], join(root, 'sub'), '{{ a.crv }}\n')
    expect(result.stdout).toBe('<p>Root A.</p>\n')
    expect(result.status).toBe(0)
  })

  it('C2-N-004: --no-includes turns expansion off, and fmt never expands', () => {
    const root = tree({ 'main.crv': '{{ a.crv }}\n', 'a.crv': 'A.\n' })
    expect(cli(['render', '--no-includes', 'main.crv'], root).stdout).toBe('<p>{{ a.crv }}</p>\n')
    expect(cli(['fmt', 'main.crv'], root).stdout).toBe('{{ a.crv }}\n')
  })

  it('C2-N-004, C2-N-014: on standard input nothing expands unless a root is named', () => {
    const root = tree({ 'a.crv': 'A.\n' })
    expect(cli(['render'], root, '{{ a.crv }}').stdout).toBe('<p>{{ a.crv }}</p>\n')
    expect(cli(['render', `--include-root=${root}`], root, '{{ a.crv }}').stdout).toBe('<p>A.</p>\n')
  })

  it('C2-N-014: a named root contains the entry\'s includes; a path out of it is reported', () => {
    const root = tree({ 'book/main.crv': '{{ ../outside.crv }}\n', 'outside.crv': 'Out.\n' })
    const result = cli(['diagnostics', 'book/main.crv'], root)
    expect(result.stdout).toContain('include-outside-root')
    expect(cli(['render', '--include-root', root, 'book/main.crv'], root).stdout).toBe('<p>Out.</p>\n')
  })

  it('C2-N-019: ast writes the expanded tree with the file of each node', () => {
    const root = tree({ 'main.crv': '{{ a.crv }}\n', 'a.crv': 'A.\n' })
    const tree2 = JSON.parse(cli(['ast', 'main.crv'], root).stdout) as { children: { file?: string, children?: { pos?: { file?: string } }[] }[] }
    expect(tree2.children[0]!.file).toBe('a.crv')
    expect(tree2.children[0]!.children![0]!.pos?.file).toBe('a.crv')
  })
})
