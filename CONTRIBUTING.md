# Contributing to MobileRepoMap

Thanks for helping. MobileRepoMap is a heuristic static analyzer, so it gets better one real-world code pattern at a time. Bug reports with a minimal snippet are as valuable as code.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need Node 18.17 or newer and git.

```bash
git clone https://github.com/ananya-kaul/mobile-repo-map.git
cd mobile-repo-map
npm install
npm test
```

Run the CLI from your checkout against the bundled examples:

```bash
node bin/mobile-repo-map.js examples/flutter_shop --open
node bin/mobile-repo-map.js examples/swiftui_notes --open
```

Or against any app on your machine:

```bash
node bin/mobile-repo-map.js ~/code/some-app --out /tmp/some-app-map --open
```

`npm run demo` regenerates the demo reports in `docs/demo/` from the examples. Run it when a change affects the report output, and commit the result alongside your change.

## Project layout

```text
bin/        CLI entry point (argument parsing, console output)
src/        analysis pipeline and report writers
src/lang/   the lexer and the Dart and Swift extractors
test/       tests, run with the built-in node:test runner
examples/   small sample apps used for smoke tests and the demo
docs/       screenshot and the generated demo reports
```

Tests use Node's built-in runner, so there is nothing extra to install. To run a single file:

```bash
node --test test/<name>.test.js
```

## Adding or fixing a detection pattern

Most contributions are of the form "it missed this route" or "it thinks this is an API call when it isn't". Work test-first:

1. **Start from a minimal snippet.** Cut the real code down to the smallest Dart or Swift that still shows the problem. If there is an issue for it, link it.
2. **Add a fixture and a failing test first.** Put the snippet in a test (inline or as a small fixture file under `test/`) and assert what the extractor should produce. Run `npm test` and confirm it fails for the right reason.
3. **Make it pass.** Language-specific patterns belong in the extractors in `src/lang/`. Cross-file logic (constants, enums, route tables, attribution to screens) belongs in the project-wide resolver. If the pattern depends on comments or string contents being ignored, rely on the lexer's blanked output rather than adding a new regex over raw source.
4. **Check for regressions.** Run `npm test`, then run the CLI on both examples and on at least one real project if you have one, and compare the reports before and after.
5. **Document it.** If the change adds support for a new library or construct, update the "Supported patterns" table in the README and add a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).

Prefer conservative patterns. A missing edge is easy to spot and report; a wrong edge quietly misleads whoever reads the map.

If a whole app shape is not covered (a new router or networking library, for example), consider extending one of the `examples/` apps so the smoke test and the demo exercise it too.

## Code style

- **Plain ESM JavaScript.** No TypeScript, no transpiler, no build step. The code that runs is the code in the repo.
- **Node built-ins first.** No new runtime dependencies without discussing it in an issue first. Every dependency is something every `npx` user downloads. Dev dependencies are also worth a conversation.
- **Analysis stays local.** The analyze and `context` commands must never make network requests. Only `ask` may, and only after showing which files it will send.
- **The HTML report stays a single offline file.** Inline everything; no CDN scripts, fonts or images.
- **Small, pure functions** that take text in and return data out are easiest to test. Add a short JSDoc comment to exported functions.
- Match the formatting of the file you are editing (2-space indentation, single quotes, semicolons).

## Pull request checklist

Before opening a PR:

- [ ] `npm test` passes locally
- [ ] New or changed detection has a fixture snippet and a test that failed before the fix
- [ ] Ran the CLI on `examples/flutter_shop` and `examples/swiftui_notes` and the reports look right
- [ ] No new runtime dependencies (or they were agreed in an issue first)
- [ ] No network access added outside `ask`; the HTML report still works offline
- [ ] README "Supported patterns" and `CHANGELOG.md` updated if user-facing behavior changed
- [ ] Demo reports regenerated with `npm run demo` if the report output changed

Keep PRs focused: one pattern or one fix per PR is much easier to review than a batch.

## Reporting problems

- **Wrong or missed screen, route, API call or cycle:** use the [detection issue template](https://github.com/ananya-kaul/mobile-repo-map/issues/new?template=false_positive.yml) and include a minimal snippet.
- **Crashes and other bugs:** use the [bug report template](https://github.com/ananya-kaul/mobile-repo-map/issues/new?template=bug_report.yml).
- **Security issues:** do not open a public issue. See [SECURITY.md](SECURITY.md).

Please strip proprietary code, API keys and internal URLs from anything you paste.
