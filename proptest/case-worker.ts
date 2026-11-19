import { parentPort } from 'node:worker_threads'
import { check } from './check.ts'
import { type Target } from './targets.ts'
import { random } from './generate.ts'

interface Request { target: Target, source: string, seed: number }

parentPort?.on('message', (request: Request) => {
  try { parentPort?.postMessage(check(request.target, request.source, random(request.seed))) }
  catch (error) {
    parentPort?.postMessage({ kind: 'harness-exception', detail: error instanceof Error ? error.stack : String(error) })
  }
})
