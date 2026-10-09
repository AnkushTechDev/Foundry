# Foundry

Foundry is a multi-tenant workspace for building data models, REST APIs, workflows, and web apps without writing application code. Builders edit JSON metadata. A separate runtime executes that metadata.

## Run it locally

```bash
docker compose up -d
cp .env.example apps/api/.env
pnpm install
pnpm --filter @foundry/shared build
pnpm --filter @foundry/workflow-engine build
pnpm dev
```

- App: http://localhost:3000
- API docs: http://localhost:4000/docs

`docker compose up -d` starts MongoDB and Redis. Add `--profile app` to run the API, worker, and web containers instead of the local dev servers.

Set `OPENAI_API_KEY` when you want the AI builder to call a model. Without it, a local planner still produces validated collections, CRUD APIs, and pages.

## Customer Manager

1. Register and create a project.
2. Open Database and create Customer, or use the Customer starter.
3. Click Generate CRUD API. That writes five workflows and a page.
4. Open the page, preview it, add a customer, and confirm the table reloads.
5. Publish, then open the published URL. Draft edits stay off that URL until the next publish.

## Layout

- `apps/web` — Next.js builder, preview, and published apps
- `apps/api` — NestJS control plane and runtime
- `apps/worker` — BullMQ process for scheduled workflows
- `packages/shared` — schemas, safe expressions, templates
- `packages/workflow-engine` — graph executor used by the API

Expressions such as `{{trigger.body.email}}` are parsed. They are never passed to `eval`. Secrets are encrypted, API keys are stored as hashes, and outbound HTTP nodes refuse private network addresses.
