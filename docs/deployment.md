# Deployment guide

## Local fixture

```bash
cp .env.example .env
pnpm install
pnpm demo
```

The command starts PostgreSQL/pgvector, Valkey, and MinIO, applies migrations, seeds synthetic data, and starts the API, worker, and browser interview runtime.

## Runtime modes

### Fixture preview

```dotenv
AI_MODE=fixture
INTERVIEW_RUNTIME=browser-demo
```

No external AI key is required.

### OpenAI-compatible AI

```dotenv
AI_MODE=openai-compatible
AI_BASE_URL=https://provider.example/v1
AI_API_KEY=replace-through-secret-manager
AI_MODEL=provider-model-name
```

Do not store these values in a tracked file or build artifact.

### External interview provider

```dotenv
INTERVIEW_RUNTIME=external
INTERVIEW_BASE_URL=https://provider-internal.example
INTERVIEW_PUBLIC_BASE_URL=https://interview.example
INTERVIEW_BRIDGE_PUBLIC_BASE_URL=https://recruit.example
INTERVIEW_BRIDGE_CALLBACK_SECRET=replace-through-secret-manager
```

The private provider base is used by the Platform API. The public base is placed in candidate entry URLs. The Bridge public base must be reachable by the provider callback.

## Production checklist

- Pin all container images and dependency versions.
- Use managed or hardened PostgreSQL, queue, and object storage.
- Replace local credentials, salts, and callback secrets.
- Store secrets in a managed secret store.
- Require TLS and restrict service networks.
- Add authentication, authorization, and tenant isolation.
- Configure callback and origin allowlists.
- Back up workflow state and test restores.
- Define retention, deletion, and export procedures.
- Add monitoring without logging raw candidate content.
- Run secret scanning, dependency review, CodeQL, and the fixture E2E test.

## Health endpoints

- Platform: `/api/health` and `/healthz`
- Interview provider: `/healthz`

They expose current modes and dependency readiness only. They do not return secrets, configured private URLs, or filesystem paths. Optional document-text extractors are reported separately and do not make the core fixture runtime unhealthy; install and monitor a supported PDF extractor before accepting production documents.
