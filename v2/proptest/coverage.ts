#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { TARGETS } from './targets.ts'

const totalMinutes = Number(process.argv[2] ?? '10')
const each = totalMinutes / TARGETS.length
mkdirSync('v2/proptest/coverage-logs', { recursive: true })
for (const target of TARGETS) {
  const result = spawnSync(process.execPath, ['v2/proptest/run.ts', '--target', target, '--seed', '20261114',
    '--count', '100000000', '--minutes', String(each), '--max-bytes', '4096', '--coverage'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  })
  writeFileSync(`v2/proptest/coverage-logs/${target}.log`, result.stdout + result.stderr)
  console.log(`${target}: ${result.status ?? 'signal'} ${result.stdout.split('\n').at(-2) ?? ''}`)
}
