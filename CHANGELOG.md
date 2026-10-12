# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-12

Initial release.

### Added

- Zero-config CLI: `npx mobile-repo-map .` statically analyzes Dart (Flutter) and Swift (iOS) projects with no build, no compile and no API key, and writes `./mobile-repo-map-report/`.
- Three outputs: a single-file offline `index.html` report, `ARCHITECTURE.md` with Mermaid diagrams that render on GitHub, and a machine-readable `report.json`.
- Report tabs:
  - **Overview**: project stats, detected stack, and an A–F health score with a breakdown.
  - **Architecture**: force-directed graph of files or modules, colored by role, with search, filters and a details panel.
  - **Navigation**: screen-to-screen flows for go_router (including nested routes and enhanced-enum paths), auto_route, GetX, `MaterialApp` routes, `onGenerateRoute`, `Navigator.push` and modals; SwiftUI `NavigationLink`, `navigationDestination`, `sheet`, `fullScreenCover` and `popover`; UIKit push, present and `setViewControllers`; Storyboard segues. Navigation inside reusable widgets is attributed to the screens that use them.
  - **APIs**: network calls for dio, http, retrofit, chopper, web sockets, socket.io, Firestore, Cloud Functions and Supabase; URLSession, Alamofire, Moya and WebSocket. Constants are resolved, and each endpoint lists the screens that use it.
  - **Risks**: import and module cycles with example chains, the most complex files and functions, hotspots (complexity × git churn over 12 months), untested files per role (with `coverage/lcov.info` support), and god files.
  - **Files**: a sortable table of every analyzed file.
- `ask` command for optional questions about the codebase via Anthropic, OpenAI, any OpenAI-compatible server or a local Ollama. It prints the files it will send first, and `--dry-run` previews the prompt without sending.
- `context` command that prints an AI-ready Markdown summary to paste into any chat.
- CI options: `--fail-on-cycles` and `--min-score <n>`.
- Other options: `--out`, `--format`, `--json`, `--open`, `--no-git`, `--exclude`, `--editor`, `--quiet`.
- Purpose-built lexer for Dart and Swift (raw and triple-quoted strings, string interpolation, nested block comments) and a project-wide resolver for constants, enhanced enums, widget inheritance and route tables.
- Example apps: `examples/flutter_shop` (go_router, Riverpod, dio, Firestore) and `examples/swiftui_notes` (SwiftUI, UIKit, URLSession, Alamofire).

[Unreleased]: https://github.com/ananya-kaul/mobile-repo-map/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ananya-kaul/mobile-repo-map/releases/tag/v0.1.0
