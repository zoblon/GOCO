# Security Policy

## Reporting a vulnerability

Please report security problems **privately** through GitHub Security Advisories:
[Report a vulnerability](https://github.com/zoblon/GOCO/security/advisories/new).

Please do not open a public issue for a vulnerability. Include the affected version, steps to reproduce and the impact you see. This is a hobby project maintained by one person; I will answer as soon as I can and credit you in the release notes if you wish.

*Deutsch:* Sicherheitslücken bitte nicht öffentlich als Issue melden, sondern vertraulich über die oben verlinkten GitHub Security Advisories.

## Supported versions

Only the latest release receives fixes.

## Scope and known design limits

- The local server listens on `127.0.0.1` only, but has no authentication. Any program running on the Mac can use it while it runs.
- API keys (MOCO, OpenAI) and the secret calendar address are stored unencrypted in the browser's local storage. See [PRIVACY.md](PRIVACY.md).
- The app is signed ad hoc and not notarized. Download it only from the GitHub releases of this repository and compare the SHA-256 checksum.
- The bundled Node.js binary is the unmodified official build from nodejs.org, verified against its published checksums during the build.

Reports about these documented limits are welcome as suggestions but are not treated as vulnerabilities.
