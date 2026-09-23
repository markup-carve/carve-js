import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The CLI is almost never launched by its real path. `npx`, a
 * `node_modules/.bin` shim and a global install all hand node a SYMLINK, so
 * `process.argv[1]` names the link while `import.meta.url` names the file it
 * points at. An entry guard comparing the two raw strings sees no match,
 * skips `main`, and exits 0 having rendered nothing (#1909) - a failure that
 * looks like an empty document rather than a broken tool.
 *
 * So this launches the built binary the way a consumer does, through a link
 * the test makes itself, and asserts on the process's own output and exit
 * code. A unit test on a path helper cannot see this: the bug is in how the
 * process was started, not in what the helper computes.
 */

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const DOC = '# Title\n\nsome text\n'

let dir: string
let doc: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'carve-bin-'))
  mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
  doc = join(dir, 'notes.crv')
  writeFileSync(doc, DOC, 'utf8')
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const runCarve = (bin: string): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [bin, '--markdown', doc], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('the CLI entry guard', () => {
  it('renders when launched by its real path', () => {
    // The path that already worked, kept under test so a fix for the symlink
    // case cannot quietly trade one launch shape for the other.
    const { status, stdout } = runCarve(CLI)

    expect(stdout).toContain('# Title')
    expect(status).toBe(0)
  })

  it('renders when launched through a node_modules/.bin symlink', () => {
    // What `npx` and every local install do.
    const shim = join(dir, 'node_modules', '.bin', 'carve')
    symlinkSync(CLI, shim, 'file')

    const { status, stdout } = runCarve(shim)

    expect(stdout).toContain('# Title')
    expect(status).toBe(0)
  })

  it('renders when the package directory itself is a symlink', () => {
    // pnpm, a yarn link and a workspace checkout all install the package as a
    // link to a directory, so `argv[1]` and the resolved module can differ by
    // a parent segment rather than by the file name.
    const linkedPkg = join(dir, 'linked-package')
    symlinkSync(fileURLToPath(new URL('../dist', import.meta.url)), linkedPkg, 'dir')

    const { status, stdout } = runCarve(join(linkedPkg, 'cli.js'))

    expect(stdout).toContain('# Title')
    expect(status).toBe(0)
  })

  it('imports without running, whatever argv[1] holds', () => {
    // The guard's other job. `argv[1]` here is the importing script, which
    // must not be mistaken for the CLI, and importing must not print or set a
    // failing exit code.
    const probe = join(dir, 'probe.mjs')
    writeFileSync(
      probe,
      `import ${JSON.stringify(CLI)}\nprocess.stdout.write('IMPORTED\\n')\n`,
      'utf8',
    )

    const result = spawnSync(process.execPath, [probe], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    expect(result.stdout).toBe('IMPORTED\n')
    expect(result.status).toBe(0)
  })

  it('does not crash when argv[1] names nothing on disk', () => {
    // `node -e` leaves `argv[1]` unset, and an embedding can leave it pointing
    // at a path that does not resolve. Resolving it is allowed to answer "not
    // the entry module"; it is not allowed to throw, which would turn a silent
    // no-op into a crash.
    const result = spawnSync(
      process.execPath,
      ['-e', `import(${JSON.stringify(CLI)}).then(() => process.stdout.write('OK\\n'))`],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('OK\n')
    expect(result.status).toBe(0)
  })
})
