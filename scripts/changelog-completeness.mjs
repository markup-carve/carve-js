#!/usr/bin/env node
/*
 * Every pull request that moved shipped source in this release is cited in the
 * release's changelog section.
 *
 * WHY THIS EXISTS. A `chore: cut X.Y.Z` commit writes the `## [X.Y.Z]` section
 * and then development simply carries on over it. Nobody reopens the section,
 * and weeks later the tag ships notes describing only the handful of changes
 * that existed on cut day. Measured across three engines in one night:
 * carve-rs 0.1.7 documented 3 of 24 merges, carve-php 0.1.10 documented 1 of
 * 22, and this repository's 0.1.8 section documented 1 of 18. `[Unreleased]`
 * was empty in every case, so the work was recorded nowhere. The guard already
 * in the release workflow asks whether a section EXISTS and carries notes;
 * that passes happily on a section covering 3 of 24 changes. Existence is not
 * completeness, so this asks the other question.
 *
 * WHY THE FILTER IS SHIPPED SOURCE, NOT THE COMMIT PREFIX. A `fix:` prefix is
 * a convention people drift from, and a `chore:`-prefixed merge can still move
 * the parser. Whether the diff touched SHIPPED is a fact about the commit
 * rather than a claim in its subject, so that is what decides.
 *
 * WHY IT ASKS GITHUB WHAT A PULL REQUEST CLOSES. The entries here cite the
 * ISSUE a fix answers, not the pull request that carried it: the hard-break
 * fix in 0.1.7 arrived as #1857 and is written up as `(#1856)`. A gate that
 * demanded the pull request number would have failed that correctly documented
 * release, and a check that cries wolf is one somebody deletes. So a pull
 * request counts as cited under its own number or under any issue it closes.
 *
 * Run:  node scripts/changelog-completeness.mjs [version] [options]
 *
 *   version        the release to check; defaults to package.json's version
 *   --at <rev>     read history and CHANGELOG.md as of this revision; defaults
 *                  to the tag when it exists, otherwise HEAD
 *   --previous <t> measure from this tag instead of the highest version tag
 *                  below `version`
 *   --section <h>  the heading to read; defaults to `version`
 *   --repo <o/n>   this repository's slug; defaults to GITHUB_REPOSITORY, then
 *                  the origin remote
 *   --root <dir>   the checkout to read; defaults to the working directory
 *
 * Needs `gh` authenticated (the release workflow passes GITHUB_TOKEN). It
 * refuses to run without it rather than degrading to an answer it cannot back.
 *
 * Exit 0  every shipped-source pull request in range is cited or exempt.
 * Exit 1  at least one is not, and every one of them is named below.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Shipped source for this package: the TypeScript the tarball is built from.
// A change anywhere under it can reach a consumer, so it owes the reader a
// changelog line.
const SHIPPED = [/^src\//];
// `src/version.ts` carries LIB_VERSION, which the release cut bumps and a test
// pins to package.json. Every release moves it and no release owes it a line,
// so counting it would put the cut's own pull request on this list every time.
const NOT_SHIPPED = [/^src\/version\.ts$/];

const EXEMPT_FILE = '.changelog-exempt';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const at = args.indexOf(name);
    return at < 0 ? fallback : args[at + 1];
};
const positional = (() => {
    const out = [];
    for (let i = 0; i < args.length; i += 1) {
        if (args[i].startsWith('--')) { i += 1; continue; }
        out.push(args[i]);
    }
    return out;
})();

const root = resolve(flag('--root', process.cwd()));
const run = (cmd, rest, input) =>
    execFileSync(cmd, rest, { cwd: root, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 }).trim();
const git = (...rest) => run('git', rest);

const version = (positional[0] ?? JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version)
    .replace(/^v/, '');
const section = flag('--section', version);

const revExists = (rev) => {
    try { git('rev-parse', '--verify', '--quiet', `${rev}^{commit}`); return true; } catch { return false; }
};
const at = flag('--at', revExists(version) ? version : 'HEAD');

const slug = (() => {
    const given = flag('--repo', process.env.GITHUB_REPOSITORY);
    if (given) return given;
    const url = git('remote', 'get-url', 'origin');
    return (url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/) ?? [])[1];
})();
const [owner, name] = slug.split('/');

// ---------------------------------------------------------------------------
// The range: from the highest version tag strictly below this release.

const VERSION_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;
const order = (a, b) => {
    const x = a.match(VERSION_TAG).slice(1).map(Number);
    const y = b.match(VERSION_TAG).slice(1).map(Number);
    for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
};

const previous = (() => {
    const given = flag('--previous');
    if (given) return given;
    const below = git('tag', '--merged', at)
        .split('\n').map((t) => t.trim())
        .filter((t) => VERSION_TAG.test(t) && order(t, version) < 0);
    return below.length ? below.sort(order).pop() : undefined;
})();

const range = previous ? `${previous}..${at}` : at;

// ---------------------------------------------------------------------------
// What merged, and what of it touched shipped source.

const RECORD = '\u001f';
const commits = git('log', `--format=%H${RECORD}%s`, range).split('\n').filter(Boolean)
    .map((l) => { const [sha, subject] = l.split(RECORD); return { sha, subject }; });

const touchesShipped = (sha) =>
    git('diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', '--root', sha)
        .split('\n').filter(Boolean)
        .some((f) => SHIPPED.some((re) => re.test(f)) && !NOT_SHIPPED.some((re) => re.test(f)));

// A squash merge carries its pull request as a trailing `(#N)`, the only
// number on the commit that can lead anywhere.
const pullRequest = (subject) => (subject.match(/\(#(\d+)\)\s*$/) ?? [])[1];

const shipping = new Map(); // number -> title
const unattributed = [];
for (const { sha, subject } of commits) {
    if (!touchesShipped(sha)) continue;
    const number = pullRequest(subject);
    if (!number) { unattributed.push({ sha: sha.slice(0, 9), subject }); continue; }
    if (!shipping.has(number)) shipping.set(number, subject.replace(/\s*\(#\d+\)\s*$/, ''));
}

// ---------------------------------------------------------------------------
// What each pull request closes, batched by alias so this is a few requests
// rather than one per pull request.

const closes = new Map(); // pull request number -> [issue numbers]
const numbers = [...shipping.keys()];
for (let i = 0; i < numbers.length; i += 50) {
    const chunk = numbers.slice(i, i + 50);
    const fields = chunk
        .map((n) => `p${n}: pullRequest(number:${n}){number title closingIssuesReferences(first:30){nodes{number}}}`)
        .join('\n');
    const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${fields}}}`;
    let answer;
    try {
        answer = run('gh', ['api', 'graphql', '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', 'query=@-'], query);
    } catch (e) {
        console.log('::error::could not ask GitHub what these pull requests close, so completeness cannot be judged.');
        console.log(`::error::${String(e.stderr ?? e.message).trim().split('\n')[0]}`);
        process.exit(1);
    }
    const repo = JSON.parse(answer).data?.repository ?? {};
    for (const node of Object.values(repo)) {
        if (!node) continue;
        closes.set(String(node.number), node.closingIssuesReferences.nodes.map((n) => String(n.number)));
        if (node.title) shipping.set(String(node.number), node.title);
    }
}

// ---------------------------------------------------------------------------
// What the section cites. A qualified reference to ANOTHER repository is not a
// citation of this one, so the owner is checked rather than grepping `#N`.

const changelog = (() => {
    try { return git('show', `${at}:CHANGELOG.md`); }
    catch { return readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'); }
})();

const sectionText = (() => {
    const lines = changelog.split('\n');
    const head = new RegExp(`^## \\[?${section.replace(/\./g, '\\.')}\\]?(\\s|\\]|$)`);
    const start = lines.findIndex((l) => head.test(l));
    if (start < 0) return undefined;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^## /.test(l));
    return (end < 0 ? rest : rest.slice(0, end)).join('\n');
})();

if (sectionText === undefined) {
    console.log(`::error::CHANGELOG.md has no '## [${section}]' section to check`);
    process.exit(1);
}

const cited = new Set();
for (const [, qualifier, number] of sectionText.matchAll(/(?:([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+))?#(\d+)\b/g)) {
    if (qualifier && qualifier.toLowerCase() !== slug.toLowerCase()) continue;
    cited.add(number);
}

// ---------------------------------------------------------------------------
// Deliberate exclusions stay VISIBLE. An exemption with no reason is refused,
// so the escape hatch cannot decay into a list of bare numbers nobody can
// audit, and every one that applies is printed on a passing run too.

const exemptions = new Map();
const malformed = [];
const exemptPath = resolve(root, EXEMPT_FILE);
if (existsSync(exemptPath)) {
    readFileSync(exemptPath, 'utf8').split('\n').forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        const m = line.match(/^#?(\d+)\s*[:\s]\s*(\S.*)$/);
        if (!m) { malformed.push(`${EXEMPT_FILE}:${i + 1}: expected '<number>: <reason>', got '${line}'`); return; }
        exemptions.set(m[1], m[2].trim());
    });
}

const missing = [];
const skipped = [];
for (const [number, title] of [...shipping].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (cited.has(number)) continue;
    if ((closes.get(number) ?? []).some((issue) => cited.has(issue))) continue;
    if (exemptions.has(number)) { skipped.push([number, title, exemptions.get(number)]); continue; }
    missing.push([number, title]);
}

for (const [number, title, reason] of skipped) {
    console.log(`exempt: #${number} ${title}\n        (${EXEMPT_FILE}: ${reason})`);
}
for (const { sha, subject } of unattributed) {
    console.log(`::notice::${sha} touched shipped source with no pull request to cite: ${subject}`);
}

const from = previous ? `since ${previous}` : 'so far';
if (malformed.length || missing.length) {
    for (const e of malformed) console.log(`::error::${e}`);
    for (const [number, title] of missing) {
        const also = closes.get(number)?.length ? ` (closes ${closes.get(number).map((n) => `#${n}`).join(', ')})` : '';
        console.log(`::error::#${number}${also} is not cited in the ${section} section: ${title}`);
    }
    if (missing.length) {
        console.log(
            `changelog-completeness: ${missing.length} of ${shipping.size} pull request(s) ${from} moved ` +
            `shipped source and are cited nowhere in the ${section} section. Write them up, or exempt ` +
            `one with a reason in ${EXEMPT_FILE}.`,
        );
    }
    process.exit(1);
}

console.log(
    `changelog-completeness: the ${section} section accounts for all ${shipping.size - skipped.length} ` +
    `shipped-source pull request(s) ${from}` +
    (skipped.length ? `, ${skipped.length} exempt` : '') +
    (unattributed.length ? `, ${unattributed.length} commit(s) carrying no pull request` : ''),
);
