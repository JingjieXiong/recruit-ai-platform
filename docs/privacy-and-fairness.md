# Privacy, fairness, and human review

This document is product and engineering guidance, not legal advice. A deployment must be reviewed against the employment, privacy, discrimination, automated-decision, biometric, and recording laws that apply to its jurisdictions.

## Data classification

Candidate resumes, portfolios, identity records, communications, interview answers, recordings, transcripts, and reports are personal data. Some may contain sensitive or protected information even when the product does not request it.

Treat the following as high risk:

- identity numbers and authentication data;
- disability, health, race, ethnicity, religion, gender, age, family status, and other protected attributes;
- face, voice, biometric, or behavioral signals;
- prior compensation and financial information;
- inferred personality, emotion, or health claims;
- interview recordings and transcripts.

## Collection and purpose limitation

- Collect only data needed for a named recruiting purpose.
- Explain what automated tools do before collecting interview or model inputs.
- Do not reuse candidate data for unrelated model training without an approved legal basis and clear notice.
- Avoid collecting video, audio, or biometric data when typed or non-biometric alternatives are sufficient.

## Fairness requirements

- Do not use protected attributes or proxy features as scoring inputs.
- Test selection rates and error rates across relevant groups where lawful and statistically meaningful.
- Evaluate language, accent, disability, connectivity, device, and assistive-technology impacts.
- Never infer emotion, honesty, personality, or health from face or voice signals.
- Review job criteria for unnecessary pedigree, school, location, or availability proxies.
- Treat missing evidence as missing evidence, not proof of inability.

## Human decision boundary

The system may organize evidence, identify gaps, draft questions, and summarize answers. It must not autonomously reject, advance, or offer employment.

A responsible reviewer should:

1. inspect source material and report citations;
2. distinguish verified evidence from model inference;
3. review missing or inaccessible materials;
4. consider reasonable accommodations and alternative assessment methods;
5. record the actual human rationale;
6. provide an appeal or correction path where required.

## Candidate rights and controls

A production implementation should support:

- notice and meaningful explanation;
- access to submitted materials;
- correction of inaccurate data;
- withdrawal and deletion requests;
- human review of automated assistance;
- retention limits and deletion verification;
- accessible non-video or non-voice alternatives.

## Security and retention

- Encrypt in transit and at rest.
- Separate candidate, recruiter, administrator, and provider access.
- Use short-lived interview entry tokens.
- Rotate callback secrets and provider credentials.
- Avoid logging raw candidate material in infrastructure logs.
- Define and enforce retention per data type.
- Delete derived reports and embeddings when their source data is deleted, unless a documented legal requirement prevents it.

## Fixture boundary

The bundled fixture uses synthetic data and fixed outputs. It exists to demonstrate workflow behavior and must not be used as a real assessment model or fairness benchmark.
