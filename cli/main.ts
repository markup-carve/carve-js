#!/usr/bin/env node
import { parseArgs, help } from './flags.ts'
import { classifyCliError, run } from './run.ts'
import { CarveWriteError } from '../src/index.ts'
import { writerHasLoss } from '../src/write.ts'
import { CARVE2_VERSION } from './version.ts'

function errorMessage(error: unknown): string {
  if (!(error instanceof CarveWriteError)) return error instanceof Error ? error.message : String(error)
  const losses = error.diagnostics.filter((entry) => writerHasLoss([entry]))
    .map((entry) => `${entry.code} at ${entry.path || '/'}`).join(', ')
  return `${error.message}: ${losses}`
}

function writeSecondaryDiagnostics(error: unknown): void {
  if (!(error instanceof CarveWriteError)) return
  for (const entry of error.diagnostics) {
    if (!writerHasLoss([entry])) process.stderr.write(`carve[${entry.code}]: ${entry.message}\n`)
  }
}

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
    const { category, status } = classifyCliError(error)
    process.stderr.write(`carve[${category}]: ${errorMessage(error)}\n`)
    writeSecondaryDiagnostics(error)
    return status
  }
}

process.exitCode = main()
