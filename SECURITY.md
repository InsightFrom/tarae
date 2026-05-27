# Security Policy

## Reporting

Please do not open a public issue for a suspected vulnerability. Use GitHub private vulnerability reporting when available, or contact the maintainers through the repository contact channel.

Include:

- A short description of the issue
- Steps to reproduce
- Affected operating systems or agents
- Any relevant logs with secrets removed

## Local History

Tarae writes session history under `.tarae/topa/` in the target project. Treat this directory as local working state. It may contain summaries, file paths, git refs, line counts, and masked log excerpts.

## Supported Versions

Security fixes target the latest released version and the default development branch.
