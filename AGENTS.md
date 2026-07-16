# Repository Guidelines

## Project Structure

- `bin/codex-reset-checker.js`: CommonJS CLI and npm entry point.
- `test/codex-reset-checker.test.js`: test suite.
- `scripts/`: legacy Bash and PowerShell helpers.
- `public/`: GitHub Pages site; `assets/`: images.
- `.github/workflows/`: CI, releases, and Pages.

## Development Commands

Requires Node.js 14+; no build.

- `npm ci`: install locked dependencies.
- `npm test`: run all tests.
- `node ./bin/codex-reset-checker.js --help`: check the CLI.
- `node ./bin/codex-reset-checker.js --json --auth /path/to/auth.json`: test JSON output.
- `npm pack --dry-run`: inspect package contents.

## Code Style

Use two spaces, single quotes, semicolons, and `const` by default. Name functions and variables with `camelCase`; name constants with `UPPER_SNAKE_CASE`. Keep CommonJS and Node.js 14 compatibility. Preserve Traditional Chinese text unless changing it. No formatter/linter is configured; match adjacent code.

## Testing Guidelines

Tests use Node's built-in `assert` and mocked APIs. Name tests `test...`, register them in `tests`, and cover one behavior per case. Include success and failure paths, human and JSON output, terminal behavior, and secret masking where relevant. CI runs `npm test` on Node.js 14, 18, 20, 22, and 24. No coverage threshold is configured.

## Security

Never commit `auth.json`, tokens, account IDs, or credential-bearing API responses. Preserve read-only behavior and secret masking in requests, logs, and JSON output.
