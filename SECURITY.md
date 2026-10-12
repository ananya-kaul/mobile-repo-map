# Security Policy

## Supported versions

MobileRepoMap is pre-1.0. Security fixes are made on the latest release only.

| Version | Supported |
|---|---|
| 0.1.x (latest) | Yes |
| Older | No |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub Security Advisories:
[Report a vulnerability](https://github.com/ananya-kaul/mobile-repo-map/security/advisories/new)
(or the **Security** tab of the repository, then **Report a vulnerability**).

Please include:

- the version (`npx mobile-repo-map --version`) and your OS and Node version
- the command you ran
- a minimal project or snippet that reproduces the problem
- what you expected and what happened

This is a small project maintained on a best-effort basis. You can expect an acknowledgement as soon as the report has been reviewed, and a fix or mitigation plan before any public disclosure. Please give a reasonable window to fix the issue before disclosing it publicly. Reporters are credited in the advisory unless they prefer otherwise.

## How MobileRepoMap handles your code

Knowing this helps decide what counts as a vulnerability.

- **Analysis runs locally.** The default command and `context` read files in the directory you point them at, read git history with `git log`, and write the report to the output directory. They do not send anything over the network.
- **The HTML report is self-contained.** It is a single offline file and should not load remote resources.
- **Only `ask` sends code**, and only to the provider you configured (Anthropic, OpenAI, an OpenAI-compatible server set via `OPENAI_BASE_URL`, or a local Ollama). It prints the list of files it will include before sending, and `--dry-run` prints the full prompt without sending anything.
- **API keys** are read from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

Examples of issues we want to hear about:

- network requests made by the analysis, the `context` command or the HTML report
- `ask` sending files or content beyond what it listed
- API keys or other environment values appearing in console output or report files
- script injection into `index.html` through crafted file names, paths or source contents
- writing or deleting files outside the chosen output directory
- crafted source files that cause excessive CPU or memory use (denial of service)

Code you choose to send with `ask` is then subject to that provider's own data policies; that is outside the scope of this project.
