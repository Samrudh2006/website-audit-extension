# Extension <-> engine boundary

The extension runs the audit engine as child processes and never
re-implements checks. The stable CLI surface (commands, exit codes, JSON
shapes, scope limits, hard rules) is documented in
[engine/INTEGRATION.md](engine/INTEGRATION.md) - that file is the contract.

Bundling rules:
- The engine ships inside the extension at `engine/`; `websiteAudit.enginePath`
  can point at another engine checkout that follows the same contract.
- Any change under `engine/tools/` must keep `bash engine/tools/tests/run-tests.sh`
  green (29 tests).
- The tools make no network calls and never send the user's source anywhere;
  the extension keeps the same rule.
