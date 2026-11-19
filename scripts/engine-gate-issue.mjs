#!/usr/bin/env node
// Called only after a complete full engine workflow run.
import { spawnSync } from 'node:child_process'

const title = 'next2 engine gates failing'
const runUrl = process.env.RUN_URL
const jobs = JSON.parse(process.env.NEEDS_JSON ?? '{}')
const failed = Object.entries(jobs).filter(([, job]) => job.result !== 'success').map(([name]) => name)
function gh(...args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', env: process.env })
  if (result.status !== 0) throw new Error(result.stderr || `gh ${args[0]} failed`)
  return result.stdout.trim()
}
const existing = JSON.parse(gh('issue', 'list', '--state', 'open', '--search', `in:title "${title}"`, '--json', 'number,title'))
  .find((issue) => issue.title === title)
if (failed.length) {
  const body = `Full engine run failed: ${runUrl}\n\nFailing jobs: ${failed.join(', ')}`
  if (existing) gh('issue', 'comment', String(existing.number), '--body', body)
  else {
    const labels = JSON.parse(gh('label', 'list', '--limit', '100', '--json', 'name')).map((entry) => entry.name)
    const args = ['issue', 'create', '--title', title, '--body', body]
    for (const label of ['bug', 'area:ci']) if (labels.includes(label)) args.push('--label', label)
    gh(...args)
  }
} else if (existing) {
  gh('issue', 'comment', String(existing.number), '--body', `Full engine run is green: ${runUrl}`)
  gh('issue', 'close', String(existing.number))
}
