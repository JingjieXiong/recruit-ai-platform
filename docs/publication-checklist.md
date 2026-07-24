# GitHub publication checklist

## Repository metadata

Repository name:

```text
recruit-ai-platform
```

About description:

```text
Open-source AI recruiting platform for resume screening, evidence-based candidate evaluation, interview planning, and AI interview orchestration.
```

Topics:

```text
ai-recruitment
ai-recruiting
hr-tech
applicant-tracking-system
resume-screening
candidate-matching
candidate-evaluation
ai-interviewer
interview-agent
digital-human
speech-to-text
text-to-speech
llm
rag
agentic-ai
fastify
postgresql
javascript
```

Social preview: `media/social-preview.png` (1280×640, under 1 MB).

## Before the first push

- [ ] Rotate or revoke every historical One API, realtime decision, and ASR credential from the private source repositories.
- [ ] Confirm the public tree was created without the private source Git history.
- [ ] Confirm no `config/local.json`, `.env`, candidate export, or runtime directory is tracked.
- [ ] Run `pnpm check`.
- [ ] Run `pnpm test:e2e`.
- [ ] Run gitleaks against the fresh Git history.
- [ ] Search for internal domains, personal paths, fixed application IDs, and private registry names.
- [ ] Confirm all images and video contain synthetic data only.
- [ ] Confirm the video remains under the selected GitHub upload limit.

## Private repository setup

- [x] Create the repository under the approved personal GitHub account as **Private**.
- [x] Push the fresh local `main`.
- [ ] Enable private vulnerability reporting after the repository becomes Public.
- [ ] Enable secret scanning and push protection after the repository becomes Public, or while Private after GitHub Secret Protection is available.
- [x] Enable Dependabot alerts and security updates.
- [ ] Enable CodeQL after the repository becomes Public, or while Private after GitHub Code Security is available.
- [ ] Protect `main`: pull request required, checks required, no force pushes, no deletions.
- [x] Set the About description and topics.
- [ ] Upload `media/social-preview.png` after the first Public switch; GitHub does not offer the initial social-preview upload for a new Private repository.

## Rights gate

Keep the repository Private until all items are confirmed:

- [ ] Project source ownership permits public distribution.
- [ ] Product name and visual assets are approved for public use.
- [ ] Third-party notices are complete.
- [ ] Any future interview provider adapter has separate authorization and licensing.
- [ ] Apache-2.0 is approved as the project license.

Only after approval:

- [ ] Add the complete Apache-2.0 `LICENSE`.
- [ ] Update README license status.
- [ ] Switch repository visibility to Public.
- [ ] Publish `v0.1.0-public-preview`.
- [ ] Attach release notes and known limitations.
- [ ] Pin the repository on the profile.

## Suggested release notes

### v0.1.0-public-preview

- Synthetic, no-key recruiting workflow from job creation to human review
- Evidence pack and structured prescreen
- Schema-validated interview plan
- Provider-neutral Browser Demo interview runtime
- Authenticated report callback and pull recovery
- English and Chinese documentation
- Public CI, CodeQL, dependency updates, and secret scanning

Known limitations:

- Local preview identity is not production authentication.
- Fixture output is synthetic and not an assessment model.
- External provider adapters are intentionally excluded.
- Production privacy, fairness, retention, and legal review remain deployment responsibilities.
