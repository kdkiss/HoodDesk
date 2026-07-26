# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected security problem. Contact the repository maintainer privately through the contact method listed on the project profile, and include a clear description, affected version or commit, reproduction steps, and impact.

We will acknowledge reports as soon as practical, investigate them, and coordinate a fix before public disclosure where appropriate.

## Operational safety

HoodDesk is experimental software. Automated execution is disabled by default and must only be enabled for a dedicated, funded execution wallet after a deployment-specific security review. Do not place a production private key in browser-accessible variables, source control, or container images.

Run the public application behind HTTPS and a reverse proxy that overwrites
client IP headers. Set `TRUST_PROXY_HEADERS=true` only for that controlled
topology. Keep dependencies current and apply database migrations before
starting the worker.
