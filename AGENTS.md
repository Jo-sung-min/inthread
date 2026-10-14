# insAuto contributor guide

This repository starts an Instagram/Threads automation service. Keep the UI and AI tool clients on the same backend business rules.

- `frontend/`: Next.js App Router, TypeScript; Korean UI. Server route handlers keep the backend API key out of browser bundles.
- `backend/`: Spring Boot 3.5.16, Java 21, Gradle wrapper. Domain state, validation, persistence, scheduling and provider adapters belong here.
- `packages/mcp-server/`: MCP stdio adapter. Call the REST API; do not duplicate domain rules.
- `backend/src/main/resources/static/openapi.yaml`: API contract for AI and external clients. Update when changing routes or DTOs.
- `docs/`: architecture, connection steps and the next implementation milestones.

Run `npm install`, `npm run typecheck`, `npm test`, and `npm run build` for relevant changes. Start both apps with `npm run dev`. Frontend uses port 3001; backend uses port 8081 to avoid the sibling fatell project.

Scheduled work uses DRY_RUN; live publication requires the explicit /publish endpoint, reviewed account ID and exact draft updatedAt. OAuth is browser-bound, account tokens are encrypted, and live publishing never retries ambiguous results. Run only one backend instance; startup marks interrupted publications UNKNOWN. `SIMULATED` never means real publication. Never quietly enable a real provider or imply that Meta accounts are connected. Production publishing requires operator-provided Meta apps and HTTPS OAuth callbacks, a private workspace session gate and stable token encryption keys. Preserve the adapter boundary and add meaningful lifecycle tests when expanding it.

Never commit `.env`, tokens, database files, or logs. Do not expose the local API-key-injecting frontend proxy publicly without user authentication and authorization. Keep timestamps in ISO 8601 with an offset; convert browser local time at the UI boundary. Use documented operationIds and structured errors so agents can recover.

Content studio uses authored templates, not an external model. Batch draft saves require a stable UUID per exact payload and commit atomically. A Threads series has exactly four segments with text equal to the first. Live series check reply grants before posting, persist each confirmed part ID, and stop on PARTIAL or UNKNOWN without automatic retry. Preserve all-parts review in UI and AI tools.
