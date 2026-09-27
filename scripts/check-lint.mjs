import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import config from '../eslint.config.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const boundaryFiles = JSON.parse(readFileSync(join(root, 'tsconfig.boundaries.json'), 'utf8')).include
const lintFiles = config.flatMap((entry) => entry.files ?? [])
assert.deepEqual([...lintFiles].sort(), [...boundaryFiles].sort(), 'Typed lint and indexed-access scopes must match')
const command = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.lint
for (const file of lintFiles) assert.ok(command.split(' ').includes(file), `Lint command omits ${file}`)
const result = spawnSync(process.execPath, [
  join(root, 'node_modules/eslint/bin/eslint.js'),
  '--stdin', '--stdin-filename', 'src/source-positions.ts', '--format', 'json',
], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120_000,
  input: `
    declare const input: any;
    const value: string = input;
    input();
    input.property;
    function acceptsString(value: string): void {}
    acceptsString(input);
    function returnsString(): string { return input; }
    Promise.resolve(value);
    if (Promise.resolve(value)) acceptsString(value);
    declare const tag: 'a' | 'b';
    switch (tag) { case 'a': break; }
  `,
})
assert.equal(result.status, 1, `Expected lint violations: ${result.error ?? result.stderr}\n${result.stdout}`)
const rules = new Set(JSON.parse(result.stdout).flatMap(file => file.messages.filter(message => message.severity === 2).map(message => message.ruleId)))
for (const rule of [
  'no-unsafe-assignment', 'no-unsafe-argument', 'no-unsafe-call',
  'no-unsafe-member-access', 'no-unsafe-return', 'no-floating-promises',
  'no-misused-promises', 'switch-exhaustiveness-check',
]) {
  assert.ok(rules.has(`@typescript-eslint/${rule}`), `Lint did not reject ${rule}`)
}
console.log('Typed lint rejects unsafe values, promises and incomplete switches.')
