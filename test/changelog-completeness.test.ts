import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(__dirname, '../scripts/changelog-completeness.mjs')

// A wave pull request lands as a merge commit; the gate must ask it for an entry.
describe('changelog completeness gate', () => {
  let dir: string
  let bin: string
  const git = (...args: string[]): string => execFileSync('git', args, {
    cwd: join(dir, 'repo'),
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
  })
  const write = (path: string, text: string): void => writeFileSync(join(dir, 'repo', path), text)

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'changelog-gate-'))
    bin = join(dir, 'bin')
    mkdirSync(bin)
    mkdirSync(join(dir, 'repo', 'src'), { recursive: true })
    const answer = JSON.stringify({ data: { repository: { p7: { number: 7, title: 'wave', closingIssuesReferences: { nodes: [{ number: 5 }] } } } } })
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncat >/dev/null\necho '${answer}'\n`)
    chmodSync(join(bin, 'gh'), 0o755)
    git('init', '-q', '-b', 'main')
    write('src/a.ts', 'export const a = 1\n')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    git('tag', '0.1.0')
    git('checkout', '-q', '-b', 'wave')
    write('src/a.ts', 'export const a = 2\n')
    git('commit', '-q', '-am', 'parser: change a')
    git('checkout', '-q', 'main')
    git('merge', '-q', '--no-ff', 'wave', '-m', 'Merge pull request #7 from o/wave')
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const gate = (changelog: string) => {
    write('CHANGELOG.md', changelog)
    return spawnSync('node', [script, '0.1.1', '--at', 'HEAD', '--previous', '0.1.0', '--repo', 'o/n', '--root', join(dir, 'repo')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
  }

  it('asks a merge-commit pull request for an entry', () => {
    const out = gate('# Changelog\n\n## [0.1.1]\n\n- Something else.\n')
    expect(out.stdout).toContain('#7')
    expect(out.stdout).not.toContain('no pull request to cite')
    expect(out.status).toBe(1)
  })

  it('accepts the entry once it cites the issue the pull request closes', () => {
    const out = gate('# Changelog\n\n## [0.1.1]\n\n- Changed a (#5).\n')
    expect(out.stdout).not.toContain('no pull request to cite')
    expect(out.status).toBe(0)
  })
})
