#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs, help } from './flags.ts'
import { CliError, run } from './run.ts'

function main(): number {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) { process.stdout.write(help(args.command)); return 0 }
    if (args.version) {
      const manifest: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
      if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) process.stdout.write(`${manifest.version}\n`)
      return 0
    }
    return run(args)
  } catch (error) {
    const category = error instanceof CliError ? error.category : 'usage'
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`carve[${category}]: ${message}\n`)
    return 2
  }
}

process.exitCode = main()
