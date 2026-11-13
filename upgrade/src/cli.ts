#!/usr/bin/env node
// carve upgrade [--check] [--write] [--json] [--force] FILE...
import { readFileSync, writeFileSync } from 'node:fs'
import { ENGINE_01_VERSION } from './engines.ts'
import { formatRecord } from './report.ts'
import { needsAttention, upgrade, type UpgradeResult } from './upgrade.ts'

const USAGE = 'usage: carve-upgrade [--check] [--write] [--json] [--force] FILE...'

/** U-079: printed once per run, because the tool cannot see what a host set. */
const OPTION_NOTICE = [
  'U-079 report: render options of the host are not in the document. In 0.2:',
  '  rawHtml is off by default (pass --raw-html to keep raw HTML),',
  '  codeBlockTabWidth is gone, and five roundtrip carrier names are removed.',
].join('\n')

interface Flags {
  check: boolean
  write: boolean
  json: boolean
  force: boolean
  files: string[]
}

function readFlags(args: string[]): Flags | null {
  const flags: Flags = { check: false, write: false, json: false, force: false, files: [] }
  for (const arg of args) {
    if (arg === '--check') flags.check = true
    else if (arg === '--write') flags.write = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--force') flags.force = true
    else if (arg.startsWith('--')) return null
    else flags.files.push(arg)
  }
  return flags.files.length === 0 ? null : flags
}

function emit(flags: Flags, file: string, result: UpgradeResult): void {
  if (flags.check) return
  // The file is not written over a difference no entry explains, unless forced (contract, section 1).
  const blocked = result.check === 'mismatch' && !flags.force
  if (flags.write) {
    if (result.changed && !blocked) writeFileSync(file, result.output)
  } else if (flags.files.length === 1 && !flags.json) {
    process.stdout.write(result.output)
  }
}

function run(flags: Flags): number {
  let status = 0
  const all: object[] = []
  for (const file of flags.files) {
    const result = upgrade(readFileSync(file, 'utf8'))
    emit(flags, file, result)
    if (needsAttention(result) || (flags.check && result.changed)) status = 1
    if (flags.json) all.push({ file, changed: result.changed, check: result.check, records: result.records })
    else for (const record of result.records) process.stderr.write(formatRecord(file, record) + '\n')
  }
  if (flags.json) process.stdout.write(JSON.stringify({ engine01: ENGINE_01_VERSION, files: all }, null, 2) + '\n')
  else process.stderr.write(`${OPTION_NOTICE}\nread with the 0.1 engine ${ENGINE_01_VERSION}\n`)
  return status
}

const flags = readFlags(process.argv.slice(2))
if (flags === null) {
  process.stderr.write(USAGE + '\n')
  process.exitCode = 2
} else {
  process.exitCode = run(flags)
}
