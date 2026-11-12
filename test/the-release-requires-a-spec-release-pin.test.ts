import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const script = resolve(here, '../scripts/check-spec-pin-is-tag.sh')
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim()

function fleet(tag: string) {
  const root = mkdtempSync(join(tmpdir(), 'spec-pin-tag-'))
  const spec = join(root, 'spec.git')
  git(root, 'init', '-q', '--bare', spec)
  const work = join(root, 'spec-work')
  git(root, 'init', '-q', '-b', 'main', work)
  git(work, 'commit', '-q', '--allow-empty', '-m', 'released')
  const released = git(work, 'rev-parse', 'HEAD')
  git(work, 'tag', '-a', tag, '-m', tag)
  git(work, 'commit', '-q', '--allow-empty', '-m', 'after the release')
  const after = git(work, 'rev-parse', 'HEAD')
  git(work, 'push', '-q', spec, 'main', '--tags')
  return { root, spec, released, after }
}

function engine(root: string, pin: string) {
  const dir = mkdtempSync(join(root, 'engine-'))
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, '.gitmodules'), '[submodule "spec"]\n\tpath = spec\n\turl = https://example.invalid/carve.git\n')
  git(dir, 'add', '.gitmodules')
  git(dir, 'update-index', '--add', '--cacheinfo', `160000,${pin},spec`)
  git(dir, 'commit', '-q', '-m', 'pin')
  return dir
}

const check = (cwd: string, remote: string) =>
  spawnSync('bash', [script, 'spec'], { cwd, encoding: 'utf8', env: { ...process.env, SPEC_REMOTE: remote } })

it('passes a pin on a spec release tag', () => {
  const f = fleet('0.1.14')
  const run = check(engine(f.root, f.released), f.spec)
  expect(run.status, run.stderr).toBe(0)
  expect(run.stdout).toContain('is spec release 0.1.14')
})

it('refuses a pin between two spec releases', () => {
  const f = fleet('0.1.14')
  const run = check(engine(f.root, f.after), f.spec)
  expect(run.status).toBe(1)
  expect(run.stderr).toContain('is not a published spec release tag')
})

it('reports an unreachable spec remote as unable to check, not as a verdict', () => {
  const f = fleet('0.1.14')
  const run = check(engine(f.root, f.released), join(f.root, 'no-such.git'))
  expect(run.status).toBe(2)
})

it('gates the tag job on the spec pin', () => {
  const workflow = readFileSync(resolve(here, '../.github/workflows/release.yml'), 'utf8')
  expect(workflow).toContain('./scripts/check-spec-pin-is-tag.sh spec')
  expect(workflow).toMatch(/needs: \[npm-credential, spec-pin\]/)
})
