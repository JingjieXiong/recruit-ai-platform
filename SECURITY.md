# Security policy

## Supported versions

Security fixes are currently prepared for the latest `main` branch and the upcoming `v0.1.x` public preview.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository. Do not open a public issue for:

- exposed or suspected credentials;
- access-control bypasses;
- candidate data disclosure;
- unsafe file upload or object-storage behavior;
- prompt injection that crosses tenant, candidate, or job boundaries;
- interview callback forgery;
- dependency or container vulnerabilities with a working exploit.

Include the affected commit, reproduction steps using synthetic data, expected impact, and a safe remediation idea if available.

## Secrets and candidate data

- Never commit `.env`, `config/local.json`, provider credentials, callback secrets, or production exports.
- Never attach real resumes, names, identity numbers, interview recordings, or reports to an issue or pull request.
- Use the bundled synthetic fixture for all reproductions.
- Rotate any credential that has entered Git history; deleting the current file is not sufficient.

## Deployment baseline

Before any non-local deployment:

- replace all demonstration passwords and salts;
- restrict database, queue, and object storage network access;
- require TLS;
- configure origin and callback allowlists;
- protect the callback secret;
- define retention and deletion policies;
- enable audit logging and private vulnerability reporting.
