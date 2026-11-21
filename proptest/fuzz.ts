#!/usr/bin/env node
// `npm run fuzz -- [--seed S] [--minutes M] [--targets a,b] [--jobs J]`: every proptest target for M minutes per
// target (default 2) on one fresh seed (default: the current time), J targets at a time (default 1). Findings land
// in proptest/findings/TARGET/ as the runner writes them; the exit status is 1 if any target found something.
import { spawn } from 'node:child_process'
import { TARGETS } from './targets.ts'

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback
}

const seed = option('seed', String(Math.floor(Date.now() / 1000) % 0x7fffffff))
const minutes = option('minutes', '2')
const jobs = Math.max(1, Number(option('jobs', '1')))
const targets = option('targets', TARGETS.join(',')).split(',').filter((name) => name !== '')
for (const name of targets) if (!(TARGETS as readonly string[]).includes(name)) throw new Error(`unknown target ${name}`)

function runTarget(target: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['proptest/run.ts', '--target', target, '--seed', seed,
      '--count', '100000000', '--minutes', minutes, '--max-bytes', '4096'], { stdio: 'inherit' })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

const queue = [...targets]
let failed = false
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  for (let target = queue.shift(); target !== undefined; target = queue.shift()) {
    if (await runTarget(target) !== 0) failed = true
  }
}))
process.exitCode = failed ? 1 : 0
