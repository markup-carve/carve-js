import { parentPort } from 'node:worker_threads'
import { check } from './check.ts'
import { type Target } from './targets.ts'
import { random } from './generate.ts'

interface Request { target: Target, source: string, seed: number }

// The runner starts a case timer only after this, so a worker that boots on a loaded machine is not a hang.
parentPort?.postMessage('ready')

parentPort?.on('message', (request: Request) => {
  try { parentPort?.postMessage(check(request.target, request.source, random(request.seed))) }
  catch (error) {
    parentPort?.postMessage({ kind: 'harness-exception', detail: error instanceof Error ? error.stack : String(error) })
  }
})
