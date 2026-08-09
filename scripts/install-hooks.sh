#!/usr/bin/env bash
# Zo Co-browse — installs the committed git hooks.
#
# Rather than husky (which adds a runtime dev dependency), this simply points
# core.hooksPath at the committed scripts/hooks directory. The hooks there are
# plain bash scripts, so a fresh clone only needs this one-time command:
#
#   bun run setup-hooks
#
# core.hooksPath is repo-local config; it is not committed and not pushed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$ROOT/.git" ]; then
  echo "install-hooks: not a git repo ($ROOT) — nothing to install" >&2
  exit 1
fi

git -C "$ROOT" config core.hooksPath scripts/hooks

if [ -x "$ROOT/scripts/hooks/pre-commit" ]; then
  echo "install-hooks: ✓ core.hooksPath -> scripts/hooks (pre-commit gate active)"
else
  echo "install-hooks: ⚠ core.hooksPath set but scripts/hooks/pre-commit is missing/not executable" >&2
  exit 1
fi

echo "install-hooks: run \`bun run verify\` manually anytime, or let the pre-commit hook gate every commit."
