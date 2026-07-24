# Third-party notices

Recruit AI Platform depends on third-party software. This summary is provided for release preparation and does not replace review of the exact versions and license texts in the lockfile and container images.

| Component | Use | License |
| --- | --- | --- |
| Fastify and `@fastify/static` | HTTP API and static web delivery | MIT |
| BullMQ | Background jobs | MIT |
| dotenv | Environment configuration | BSD-2-Clause |
| MinIO JavaScript SDK | S3-compatible object storage client | Apache-2.0 |
| node-postgres (`pg`) | PostgreSQL client | MIT |
| Zod | Runtime schema validation | MIT |
| Playwright | Synthetic screenshots and regression automation | Apache-2.0 |
| PostgreSQL | Relational database | PostgreSQL License |
| pgvector | Vector extension and development image | PostgreSQL License |
| Valkey | Redis-compatible local queue service | BSD-3-Clause |
| MinIO Server | Optional local S3-compatible service, run as a separate container | AGPL-3.0 |

The public preview intentionally excludes vendor-specific RTC, avatar, voice, speech, and digital-human SDKs or configuration. Any future provider adapter must carry its own license and attribution review.

Before making the repository Public:

1. Generate a dependency license report from the final lockfile.
2. Pin and review container image versions and their transitive packages.
3. Confirm that project-owned source may be released under the intended Apache-2.0 license.
4. Add the complete required notices and the approved project `LICENSE`.
