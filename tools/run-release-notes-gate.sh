#!/usr/bin/env bash
# The pre-publish release-notes gate, shared by release.yml and
# rehearse-release-notes.yml so the rehearsal runs exactly what a tag runs.
#
# Usage: tools/run-release-notes-gate.sh <tag> [release-json-out]
# Reads GITHUB_REPOSITORY and GH_TOKEN. With release-json-out, the matched
# release object is written there for the caller.
#
# Found by listing rather than `gh release view <tag>`: a draft's tag is not a
# git ref, so addressing one by tag can match nothing, change nothing and
# still exit 0.
set -eo pipefail

tag="$1"
out="${2:-}"

release="$(gh api "repos/$GITHUB_REPOSITORY/releases?per_page=100" --paginate \
  | jq -cs --arg tag "$tag" '[.[][] | select(.tag_name == $tag)] | first // empty')"
if [ -z "$release" ]; then
  echo "::error::No release for $tag. Write its notes first."
  exit 1
fi
printf '%s' "$release" | python tools/check-release-notes.py \
  --tag "$tag" --repo "$GITHUB_REPOSITORY"
if [ -n "$out" ]; then
  printf '%s' "$release" > "$out"
fi
