<div align="center">

# MobileRepoMap

**Point it at any Flutter or iOS repo and get an interactive map of how the app works.**

Screens, navigation, API calls, architecture and risks, read straight from the source.<br>
Analysis runs locally. No build, compiler, or API key needed.<br>
Optional cloud questions send selected code to your configured provider; see [privacy details](#ask-ai-optional).

[![CI](https://github.com/ananya-kaul/mobile-repo-map/actions/workflows/ci.yml/badge.svg)](https://github.com/ananya-kaul/mobile-repo-map/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 18.17](https://img.shields.io/badge/node-%3E%3D18.17-339933.svg)](https://nodejs.org)
[![Zero config](https://img.shields.io/badge/config-zero-8A2BE2.svg)](#quick-start)

```bash
npx mobile-repo-map .
```

[Quick start](#quick-start) · [What you get](#what-you-get) · [Use in CI](#use-in-ci) · [Ask AI](#ask-ai-optional) · [CLI](#cli-reference) · [How it works](#how-it-works) · [Live demo report](https://ananya-kaul.github.io/mobile-repo-map/demo/flutter_shop/)

<a href="https://raw.githubusercontent.com/ananya-kaul/mobile-repo-map/main/docs/screenshot.png"><img src="https://raw.githubusercontent.com/ananya-kaul/mobile-repo-map/main/docs/screenshot.png" alt="MobileRepoMap navigation map for a Flutter app" width="900"></a>

<table>
  <tr>
    <td><a href="https://raw.githubusercontent.com/ananya-kaul/mobile-repo-map/main/docs/screenshots/overview.png"><img src="https://raw.githubusercontent.com/ananya-kaul/mobile-repo-map/main/docs/screenshots/overview.png" alt="Overview tab" width="290"></a></td>
    <td><a href="https://raw.githubusercontent.com/ananya-kaul/mobile-repo-map/main/docs/screenshots/architecture.png"><img src="https://raw.githubusercontent.com/ananya-kaul/mobile-repo-map/main/docs/screenshots/architecture.png" alt="Architecture graph" width="290"></a></td>
    <td><a href="https://raw.githubusercontent.com/ananya-kaul/mobile-repo-map/main/docs/screenshots/risks.png"><img src="https://raw.githubusercontent.com/ananya-kaul/mobile-repo-map/main/docs/screenshots/risks.png" alt="Risks tab" width="290"></a></td>
  </tr>
  <tr>
    <td align="center"><sub>Overview &amp; health score</sub></td>
    <td align="center"><sub>Architecture graph</sub></td>
    <td align="center"><sub>Risks: cycles, complexity, tests</sub></td>
  </tr>
</table>

</div>

## Try the live demos

Open the [Flutter shop report](https://ananya-kaul.github.io/mobile-repo-map/demo/flutter_shop/) or the [SwiftUI notes report](https://ananya-kaul.github.io/mobile-repo-map/demo/swiftui_notes/) in your browser. These reports use bundled example apps; no installation or repository upload is needed. Click any screenshot above to open it at full size.

## Quick start

```bash
cd my-flutter-or-ios-app
npx mobile-repo-map . --open
```

You need Node 18.17+. Git is optional (it powers the hotspot analysis).

Every run writes one folder:

```text
mobile-repo-map-report/
├── index.html        interactive report: one file, works offline
├── ARCHITECTURE.md   Mermaid diagrams that render on GitHub
└── report.json       the full model, machine-readable
```

## Why

Mobile apps hide their shape. Screens are scattered across folders, routes live in three different places, and the endpoint you're looking for is a constant concatenated two files away. MobileRepoMap reads the code and draws the shape for you.

- **Inheriting an unfamiliar codebase.** New job, client handoff, acquired app: see every screen, how they connect and which APIs they hit before you read a single file.
- **Onboarding.** Give new teammates a map instead of a two-hour tour, and commit `ARCHITECTURE.md` so it lives next to the code.
- **Refactors.** Find the import cycles, god files and churn-heavy hotspots before you start pulling threads.
- **Reviews.** Fail CI when a new import cycle appears or the health score drops below your bar.

## What you get

| Tab | What it shows |
|---|---|
| **Overview** | Project stats, the detected stack (state management, routing, networking, UI framework), and a health score from A to F with a breakdown of what moved it. |
| **Architecture** | A force-directed graph of files or modules (folders), colored by role: screen, widget, state, service, repository, model, router, entry, util, test, generated. Search, filter, and click any node for details. |
| **Navigation** | Which screen leads where, from route tables and from navigation calls in code. Navigation that happens inside a reusable widget is attributed to the screens that use it. |
| **APIs** | Every network call with constants resolved (`ApiConfig.baseUrl + '/users'` shows up as a real path), plus the screens that end up using each endpoint. |
| **Risks** | Import cycles with example chains, module cycles, the most complex files and functions (approximate cyclomatic complexity), hotspots (complexity × git churn over the last 12 months), untested files per role, and god files with high fan-in or fan-out. |
| **Files** | Every analyzed file in one sortable table. |
| **Ask AI** | Optional. Ask questions about the codebase with your own key or a local model. [Details below.](#ask-ai-optional) |

File paths in the report open directly in VS Code or Cursor (see `--editor`).

### Try it on the bundled examples

```bash
git clone https://github.com/ananya-kaul/mobile-repo-map.git
cd mobile-repo-map && npm install
node bin/mobile-repo-map.js examples/flutter_shop --open
```

`examples/flutter_shop` is a small go_router + Riverpod + dio + Firestore shop. In its report, the Overview tab picks up that stack, the Navigation tab shows the route tree including nested routes and enum-based paths, the APIs tab lists the dio and Firestore calls with their screens, and the Risks tab flags the intentional import cycle (with the chain that causes it) and the deliberately complex checkout screen.

`examples/swiftui_notes` does the same for an iOS app that mixes SwiftUI and UIKit with URLSession and Alamofire.

## Use in CI

Gate pull requests on import cycles and a minimum health score, and keep the report as a build artifact:

```yaml
# .github/workflows/repo-map.yml
name: Repo map
on: [pull_request]

jobs:
  map:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history, so hotspots can use git churn
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Map the app
        run: npx -y mobile-repo-map . --fail-on-cycles --min-score 60 --format md,json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: mobile-repo-map-report
          path: mobile-repo-map-report/
```

`--fail-on-cycles` exits with code 1 if any import cycle is found. `--min-score <n>` exits with code 1 if the health score is below `n`.

## Commit ARCHITECTURE.md

`ARCHITECTURE.md` is plain Markdown with Mermaid diagrams, which GitHub renders inline. Commit it and everyone who opens your repo gets the map without installing anything:

```bash
npx mobile-repo-map . --format md --out docs
git add docs/ARCHITECTURE.md
```

Regenerate it when the structure changes. For everything else, add `mobile-repo-map-report/` to your `.gitignore`.

## Ask AI (optional)

The report answers "what is where". For "how does X work", point a model at the code it already mapped:

```bash
export ANTHROPIC_API_KEY=...   # or OPENAI_API_KEY=..., or run Ollama locally
npx mobile-repo-map ask "How does checkout work?"
npx mobile-repo-map ask "Where is the auth token refreshed?" --dry-run
```

- **Providers:** Anthropic (`ANTHROPIC_API_KEY`), OpenAI (`OPENAI_API_KEY`), any OpenAI-compatible server (`OPENAI_BASE_URL`), or a local Ollama. The provider is auto-detected from your environment; force one with `--provider` and pick a model with `--model`.
- **No key at all?** `npx mobile-repo-map context . | pbcopy` copies an AI-ready Markdown summary of the codebase that you can paste into any chat.

> **Privacy.** Analysis never touches the network. `ask` is the only command that sends anything, and only to the provider you configured. Before sending, it prints the list of files it will include; `--dry-run` prints the whole prompt and sends nothing. With a local Ollama, the request stays on your machine.

## CLI reference

```text
mobile-repo-map [path] [options]            Analyze and write the report (default)
mobile-repo-map ask "<question>" [path]     Ask an AI about the codebase (optional)
mobile-repo-map context [path]              Print an AI-ready markdown summary

Options
  -o, --out <dir>        Output directory (default: ./mobile-repo-map-report)
  --format <list>        Comma list of html,md,json (default: all)
  --json                 Print the JSON model to stdout instead of writing files
  --open                 Open the HTML report when done
  --no-git               Skip git history (no hotspots)
  --exclude <prefix>     Skip paths starting with prefix (repeatable)
  --editor <name>        vscode | cursor | none — file links in the report (default: vscode)
  --fail-on-cycles       Exit 1 if import cycles are found (CI)
  --min-score <n>        Exit 1 if the health score is below n (CI)
  --provider <name>      ask: anthropic | openai | ollama (default: auto-detect)
  --model <id>           ask: override the model
  --dry-run              ask: print the prompt instead of sending it
  -q, --quiet            Less console output
  -h, --help / -v, --version
```

A few common combinations:

```bash
npx mobile-repo-map ../other_app -o /tmp/other-map --open      # analyze another folder
npx mobile-repo-map . --exclude lib/generated/ --exclude test/   # skip paths by prefix
npx mobile-repo-map . --json > map.json                          # JSON to stdout, no files
npx mobile-repo-map . --editor cursor                            # file links open in Cursor
```

## How it works

MobileRepoMap is static analysis built for speed of setup rather than compiler-grade precision. There is nothing to build and nothing to configure.

1. **Collect files.** Lists Dart and Swift sources (plus storyboards and project manifests), skipping build output and dependency folders such as `build/`, `.dart_tool/` and `Pods/`.
2. **Lex.** A small purpose-built lexer blanks out comments and strings so that brace matching and pattern extraction only see code. It handles Dart raw and triple-quoted strings with `${}` interpolation, Swift raw strings with `\()` interpolation, and nested block comments.
3. **Extract.** Per-language extractors pull out imports, types, screens, routes, navigation calls, network calls and complexity.
4. **Resolve.** A project-wide resolver joins it all up: constant tables (so URLs built from constants resolve), enhanced enums (`AppRoute.cart.path`), widget inheritance and route tables. Navigation and API usage are then traced back to the screens that reach them.
5. **Analyze.** Tarjan's strongly connected components algorithm finds file and module cycles. Git history from the last 12 months is combined with complexity to rank hotspots. Tests are matched to source files by imports and names, and `coverage/lcov.info` is used when present.
6. **Render.** The model is written out as a single offline HTML file, Mermaid Markdown and JSON.

It is a heuristic tool: expect some false positives and false negatives. If it gets something wrong, [report it with a minimal snippet](https://github.com/ananya-kaul/mobile-repo-map/issues/new?template=false_positive.yml). Those reports are the fastest way to make it better.

## Supported patterns

| | Flutter / Dart | iOS / Swift |
|---|---|---|
| **Dependencies read from** | `pubspec.yaml` | `Podfile`, `Package.swift` |
| **UI** | Flutter widgets | SwiftUI, UIKit, Storyboards |
| **State management** | Riverpod, Bloc, Provider, GetX, MobX | Combine, `ObservableObject`, `@Observable`, TCA |
| **Route setup** | go_router (including nested routes and enhanced-enum paths like `AppRoute.cart.path`), auto_route, GetX, `MaterialApp` routes, `onGenerateRoute` | `NavigationStack`, `UINavigationController`, Storyboards |
| **Navigation edges** | go_router, auto_route and GetX calls, `Navigator.push` / `MaterialPageRoute`, modals | `NavigationLink`, `navigationDestination`, `sheet`, `fullScreenCover`, `popover`, UIKit push / present / `setViewControllers`, Storyboard segues |
| **Networking** | dio, http, retrofit, chopper, web sockets, socket.io | URLSession, Alamofire, Moya, WebSocket |
| **Backend SDKs** | Firestore, Cloud Functions, Supabase | |
| **Tests and coverage** | Tests matched by imports and names; `coverage/lcov.info` if present | Tests matched by imports and names; `coverage/lcov.info` if present |

## Limitations

Honest list, so you know what to expect:

- **Not a type-checker.** It works from a lexer and patterns, not a full parser or the analyzer/compiler, so unusual code shapes can be missed or misread.
- **Dynamic routes** built at runtime (computed paths, routes assembled from server data) may show up as unresolved.
- **Objective-C and Android native code (Kotlin/Java)** are not analyzed yet. In a Flutter app, the Dart side is mapped; platform channels into native code are not followed.
- **Monorepos** with many packages are supported but lightly tested. Use `--exclude` to trim what you don't need.
- **Hotspots need git history.** Shallow clones (common in CI) give less churn data; use `fetch-depth: 0`, or pass `--no-git` to skip it.

## Roadmap

Ideas, not promises. If one matters to you, comment on or open a [feature request](https://github.com/ananya-kaul/mobile-repo-map/issues/new?template=feature_request.yml).

- Kotlin / Jetpack Compose, Objective-C and React Native support
- PR diff mode: what changed in the map between two commits
- A GitHub Action that comments the map and risk delta on pull requests
- A VS Code extension
- Deep link and config consistency checks: bundle IDs, permissions and URL schemes across `Info.plist`, `AndroidManifest.xml` and `pubspec.yaml`

## Contributing

Contributions are welcome, and the single most useful one is a minimal snippet the tool gets wrong. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and how to add a detection pattern. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 ananya-kaul
