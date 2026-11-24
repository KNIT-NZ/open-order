# Contributing to Open Order

Contributions are welcome through [issues](https://github.com/KNIT-NZ/open-order/issues) and pull requests. For substantial changes, discuss the purpose, scope and design before implementation. Keep changes focused and explain their expected effect.

## Development

Use a supported Node.js version compatible with the project (the initial CI baseline is Node.js 24) and npm. Install locked dependencies with `npm ci`. Consult the README, package scripts and repository configuration for project-specific instructions. Use local or synthetic data and appropriate test credentials; do not use production credentials, live databases or real user queries in tests or submissions. Never commit environment files, tokens, private logs or other secrets.

Before submitting a pull request, run the applicable checks defined in `.github/workflows/ci.yml`. Explain what was tested, what was not tested and any remaining limitations. Include appropriate regression coverage or reproducible evidence for behavioural changes. Keep dependency and lockfile changes intentional.

## Rights and attribution

Only submit material you have the right to contribute. Original software contributions are governed by the [Apache License 2.0](LICENSE), including its contribution terms, unless explicitly agreed otherwise. See [LICENSE-SCOPE.md](LICENSE-SCOPE.md) for separately governed material. Preserve required third-party notices and attribution. Do not submit protected content, personal data or culturally significant material without appropriate permissions. Disclose relevant provenance and licence obligations, including for tool-assisted contributions; contributors remain responsible for reviewing their submissions.

Be constructive and respectful. Use [SECURITY.md](SECURITY.md) for sensitive vulnerability reports.

## Procedural accuracy

Changes to retrieval, source classification, citation handling, generation or fallback behaviour should include reproducible evaluation evidence. Identify the source edition and authority for any procedural claim. Distinguish source text from interpretation, inference and generated output. Preserve appropriate abstention when evidence is insufficient. Do not imply that the tool has official parliamentary authority or endorsement.

## Automated regression and release assurance

Major new functionality must be accompanied by automated tests exercising the actual implementation. Behavioural fixes should include regression tests where practical. Run the documented test command and CI checks before merging; explain any coverage gaps. Do not use production databases, live model credentials or real user queries in automated tests.

Before a major production release, run the automated test suite and static security analysis on the exact release candidate, address warnings and confirm that medium or higher severity exploitable findings are resolved in a timely way. Review dependency advisories and credential exposure reports. Record the release identifier and human-readable notes in [CHANGELOG.md](CHANGELOG.md). Do not treat a successful scan as proof of security.
