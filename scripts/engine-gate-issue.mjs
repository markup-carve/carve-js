#!/usr/bin/env node
// Called only after a complete full engine workflow run.
import { spawnSync } from 'node:child_process'

const title = 'next2 engine gates failing'
const runUrl = process.env.RUN_URL
const runId = Number(runUrl?.match(/\/runs\/(\d+)$/)?.[1])
if (!Number.isSafeInteger(runId)) throw new Error('missing run ID')
const jobs = JSON.parse(process.env.NEEDS_JSON ?? '{}')
const failed = Object.entries(jobs).filter(([, job]) => job.result !== 'success').map(([name]) => name)
function gh(...args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', env: process.env })
  if (result.status !== 0) throw new Error(result.stderr || `gh ${args[0]} failed`)
  return result.stdout.trim()
}
const existing = JSON.parse(gh('issue', 'list', '--state', 'all', '--search', `in:title "${title}"`, '--json', 'number,title,body,state'))
  .find((issue) => issue.title === title)
const previousRunId = Number(existing?.body?.match(/Run ID: (\d+)/)?.[1] ?? 0)
if (previousRunId > runId) process.exit(0)
if (failed.length) {
  const body = `Full engine run failed: ${runUrl}\n\nRun ID: ${runId}\n\nFailing jobs: ${failed.join(', ')}`
  if (existing) {
    if (existing.state === 'CLOSED') gh('issue', 'reopen', String(existing.number))
    gh('issue', 'edit', String(existing.number), '--body', body)
    gh('issue', 'comment', String(existing.number), '--body', body)
  }
  else {
    const labels = JSON.parse(gh('label', 'list', '--limit', '100', '--json', 'name')).map((entry) => entry.name)
    const args = ['issue', 'create', '--title', title, '--body', body]
    for (const label of ['bug', 'area:ci']) if (labels.includes(label)) args.push('--label', label)
    gh(...args)
  }
} else if (existing) {
  const body = `Full engine run is green: ${runUrl}\n\nRun ID: ${runId}`
  gh('issue', 'edit', String(existing.number), '--body', body)
  if (existing.state === 'OPEN') {
    gh('issue', 'comment', String(existing.number), '--body', body)
    gh('issue', 'close', String(existing.number))
  }
}
