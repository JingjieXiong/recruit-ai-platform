# Contributing

Thank you for helping improve Recruit AI Platform.

## Before contributing

This repository is a private public-release candidate and does not yet grant an open-source license. External contributions should remain disabled until ownership review is complete and a `LICENSE` file is added.

When contributions are enabled:

1. Open an issue describing the problem, user impact, and intended scope.
2. Keep changes small and provider-neutral.
3. Use synthetic data only.
4. Run `pnpm check` and `pnpm test:e2e`.
5. Update English and Chinese documentation for user-visible changes.

## Development setup

```bash
cp .env.example .env
pnpm install
pnpm demo
```

Use `AI_MODE=fixture` for development and tests unless the change specifically concerns the OpenAI-compatible path.

## Pull request checklist

- [ ] No credentials, personal paths, internal domains, or private candidate data
- [ ] Fixture and live modes remain explicitly separated
- [ ] Model output does not become an automatic hiring decision
- [ ] Provider-specific behavior is isolated behind the provider contract
- [ ] `pnpm check` passes
- [ ] `pnpm test:e2e` passes
- [ ] Documentation and screenshots use synthetic data

## Code style

- Prefer clear modules and explicit data contracts over framework-heavy abstraction.
- Keep health endpoints free of secrets, private paths, and configured internal URLs.
- Validate model output before it reaches workflow state.
- Do not introduce silent fallback from a live provider to fixture output.

## Reporting security issues

Do not include exploit details, credentials, or candidate data in a public issue. Follow [SECURITY.md](SECURITY.md).
