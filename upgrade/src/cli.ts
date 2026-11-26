#!/usr/bin/env node
// carve upgrade [--check] [--write] [--json] [--force] FILE...
import { readFileSync, writeFileSync } from 'node:fs'
import { ENGINE_01_VERSION } from './engines.ts'
import { formatRecord } from './report.ts'
import { canWriteUpgrade, needsAttention, upgrade, type UpgradeResult } from './upgrade.ts'
import { decodeUpgradeBytes } from './bytes.ts'
import { type RegisteredExtension } from './extension-respell.ts'

const USAGE = 'usage: carve-upgrade [--check] [--write] [--json] [--force] [--registered-extension=wikilinks|samp] FILE...'

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
  registeredExtensions: RegisteredExtension[]
  files: string[]
}

function readFlags(args: string[]): Flags | null {
  const flags: Flags = { check: false, write: false, json: false, force: false, registeredExtensions: [], files: [] }
  for (const arg of args) {
    if (arg === '--check') flags.check = true
    else if (arg === '--write') flags.write = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--force') flags.force = true
    else if (arg.startsWith('--registered-extension=')) {
      const name = arg.slice('--registered-extension='.length)
      if (name !== 'wikilinks' && name !== 'samp') return null
      flags.registeredExtensions.push(name)
    }
    else if (arg.startsWith('--')) return null
    else flags.files.push(arg)
  }
  return flags.files.length === 0 ? null : flags
}

function emit(flags: Flags, file: string, result: UpgradeResult): void {
  if (flags.check) return
  const blocked = !canWriteUpgrade(result)
  if (blocked && flags.force) process.stderr.write('carve[upgrade-force-ignored]: --force cannot override the HTML check\n')
  if (flags.write) {
    if (result.changed && !blocked) writeFileSync(file, result.output)
  } else if (flags.files.length === 1 && !flags.json) {
    process.stdout.write(result.output)
  }
}

function decodeFiles(files: readonly string[]): { file: string; source: string }[] | null {
  const sources: { file: string; source: string }[] = []
  for (const file of files) {
    try {
      const source = decodeUpgradeBytes(readFileSync(file))
      sources.push({ file, source })
    }
    catch (error) {
      process.stderr.write(`carve[input-unreadable]: ${file}: ${String(error)}\n`)
      return null
    }
  }
  return sources
}

function attentionStatus(status: number, flags: Flags, result: UpgradeResult): number {
  if (status === 2) return status
  return needsAttention(result) || (flags.check && result.changed) ? 1 : status
}

function run(flags: Flags): number {
  let status = 0
  const all: object[] = []
  const sources = decodeFiles(flags.files)
  if (sources === null) return 2
  for (const { file, source } of sources) {
    const result = upgrade(source, flags.registeredExtensions)
    try { emit(flags, file, result) }
    catch (error) {
      process.stderr.write(`carve[output-unwritable]: ${file}: ${String(error)}\n`)
      status = 2
    }
    status = attentionStatus(status, flags, result)
    if (flags.json) all.push({ file, changed: result.changed, check: result.check, records: result.records })
    else for (const record of result.records) process.stderr.write(formatRecord(file, record) + '\n')
  }
  if (flags.json) process.stdout.write(JSON.stringify({ engine01: ENGINE_01_VERSION, files: all }, null, 2) + '\n')
  else process.stderr.write(`${OPTION_NOTICE}\nread with the 0.1 engine ${ENGINE_01_VERSION}\n`)
  return status
}

const flags = readFlags(process.argv.slice(2))
process.stdout.on('error', (error) => {
  process.stderr.write(`carve[output-unwritable]: stdout: ${String(error)}\n`)
  process.exitCode = 2
})
if (flags === null) {
  process.stderr.write(USAGE + '\n')
  process.exitCode = 2
} else {
  process.exitCode = run(flags)
}
