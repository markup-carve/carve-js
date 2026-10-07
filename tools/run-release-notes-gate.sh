#!/usr/bin/env bash
# The pre-publish release-notes gate, shared by release.yml and
# rehearse-release-notes.yml so the rehearsal runs exactly what a tag runs.
#
# Usage: tools/run-release-notes-gate.sh <tag> [release-json-out]
# Honors GITHUB_REPOSITORY, falling back to the origin remote, and PYTHON.
# With release-json-out, the matched release object is written there.
#
# Found by listing rather than `gh release view <tag>`: a draft's tag is not a
# git ref, so addressing one by tag can match nothing, change nothing and
# still exit 0.
set -eo pipefail

tag="$1"
out="${2:-}"

if [ -z "$tag" ]; then
  echo "::error::Usage: tools/run-release-notes-gate.sh <tag> [release-json-out]" >&2
  exit 1
fi

# RESOLVE THE INTERPRETER, DO NOT NAME ONE. Hard-coding `python` made this
# wrapper CI-only: the name exists there because actions/setup-python shims it,
# and not on a machine carrying only `python3`, where the gate died with exit
# 127 (carve-js#2557, as carve-rs#2344 before it). `python3` is probed first
# because `python` is python2 on some hosts, and a wrong interpreter is worse
# than a missing one. Resolving before the release lookup keeps an environment
# failure separate from the gate's own verdict.
python_bin="${PYTHON:-}"
if [ -z "$python_bin" ]; then
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      python_bin="$candidate"
      break
    fi
  done
fi
if [ -z "$python_bin" ]; then
  echo "::error::No Python interpreter found. Looked for python3 and python on PATH; set PYTHON to name one." >&2
  exit 1
fi

# Outside Actions nothing sets GITHUB_REPOSITORY, and an empty one asked the API
# for `repos//releases`: the gate's first symptom was a 404 plus a jq type error
# under exit 5, which reads like a broken checker rather than a missing
# variable. Derive it from the remote the checkout already names, and say which
# variable to set when even that is unavailable.
repo="${GITHUB_REPOSITORY:-}"
if [ -z "$repo" ]; then
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  # Parameter expansion rather than sed, so the one thing the gate needs before
  # it can report anything does not itself depend on another binary.
  repo="${remote%.git}"
  repo="${repo#*://}"
  repo="${repo#*@}"
  repo="${repo#*[:/]}"
  case "$repo" in
    */*) ;;
    *) repo="" ;;
  esac
fi
if [ -z "$repo" ]; then
  echo "::error::No repository to query. Set GITHUB_REPOSITORY to owner/name, or run this inside a checkout whose origin remote points at it." >&2
  exit 1
fi

release="$(gh api "repos/$repo/releases?per_page=100" --paginate \
  | jq -cs --arg tag "$tag" '[.[][] | select(.tag_name == $tag)] | first // empty')"
if [ -z "$release" ]; then
  echo "::error::No release for $tag. Write its notes first."
  exit 1
fi
printf '%s' "$release" | "$python_bin" tools/check-release-notes.py \
  --tag "$tag" --repo "$repo"
if [ -n "$out" ]; then
  printf '%s' "$release" > "$out"
fi
