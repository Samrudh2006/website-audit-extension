#!/usr/bin/env bash
# Smoke-test the packaged extension (the exact .vsix artifact), not the source tree.
# Usage: bash scripts/smoke.sh
# Requires: VS Code at /usr/share/code/code, xvfb-run, and a prior
#   npx @vscode/vsce package --allow-missing-repository --skip-license
set -u
cd "$(dirname "$0")/.."
EXT_DIR=/tmp/wa-fresh-ext/samrudh.website-audit-extension-0.1.0
rm -rf "$EXT_DIR" && mkdir -p "$EXT_DIR"
( cd "$EXT_DIR" && unzip -q -o "$OLDPWD/website-audit-extension-0.1.0.vsix" && cp -r extension/* . && rm -rf extension )

rm -rf /tmp/wa-smoke-ws && mkdir -p /tmp/wa-smoke-ws
cp engine/tools/tests/fixture-motion.html engine/tools/tests/fixture-nav-bad.html \
   engine/tools/tests/fixture-nav-good.html engine/tools/tests/fixture-collapse-bad.html /tmp/wa-smoke-ws/

run() { # name, user-data suffix, extra flags..., tests path last
  local name=$1 ud=$2 tests=$3; shift 3
  echo "== $name"
  timeout 110 xvfb-run -a /usr/share/code/code /tmp/wa-smoke-ws \
    --extensions-dir=/tmp/wa-fresh-ext --user-data-dir="/tmp/wa-fresh-$ud" \
    --extensionDevelopmentPath="$EXT_DIR" \
    --extensionTestsPath="$PWD/$tests" \
    --no-sandbox --disable-gpu --disable-dev-shm-usage "$@" > "/tmp/smoke-$name.log" 2>&1
  grep -a "SMOKE\|RESTRICTED" "/tmp/smoke-$name.log"
}

# Trusted journey: --disable-workspace-trust makes VS Code mark the CLI-opened
# folder trusted deterministically (a fresh profile otherwise decides by an
# interactive prompt, which a test host cannot answer). This flag only settles
# WHICH journey is under test; the untrusted journey is covered below.
run install-smoke ud-smoke1 test/install-smoke.js --disable-workspace-trust
# Untrusted journey: no trust flag, fresh profile starts untrusted (or the test
# forces it); every entry point must refuse without spawning Chrome or writing.
run restricted-smoke ud-smoke2 test/restricted-smoke.js
