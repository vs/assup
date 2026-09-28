# Security Policy

Assup connects to a live brokerage account and can place orders, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (the *Security → Report a vulnerability* tab of this repository).

Include a description, the affected version or commit, and steps to reproduce. You should receive an acknowledgement within a few days.

## Deployment model

Assup is designed to run **locally, for a single user**, next to your own TWS instance:

- The backend API has **no authentication**. Do not expose ports `3000`, `8080` or `5432` to the internet or to untrusted networks.
- Keep API keys in `.env`, which is git-ignored, and never commit them.
- Only list hosts you control under *Trusted IPs* in TWS. Enable *Read-Only API* if you don't need to trade from Assup.
