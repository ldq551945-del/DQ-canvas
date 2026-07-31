# web

VOZEB PRO application source files for the user workbenches, Canvas, admin console, API routes, authentication, server storage, and generation task polling.

Run local development:

```bash
pnpm install
pnpm dev
```

Build for a low-memory server:

```bash
NEXT_BUILD_CPUS=1 NODE_OPTIONS=--max-old-space-size=1024 pnpm build
pnpm start:standalone
```

The build command runs strict TypeScript checking in a separate process before the Next.js build, preventing both phases from sharing the same 1GB heap.

## Server data

PostgreSQL or the JSON Provider stores authenticated user conversations, Canvas projects, short dramas, library assets, workbench records, generation tasks, and Agent events. Images, videos, and audio are written to `VOZEB_PRO_DATA_DIR` using dated permanent or temporary directories. Keep the application data volume persistent in Docker and back it up with the database.
