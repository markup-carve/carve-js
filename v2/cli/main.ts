#!/usr/bin/env node
import { parseArgs, help } from './flags.ts'
import { CliError, run } from './run.ts'
import { CARVE2_VERSION } from './version.ts'

function main(): number {
  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) { process.stdout.write(help(args.command)); return 0 }
    if (args.version) {
      process.stdout.write(`${CARVE2_VERSION}\n`)
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
