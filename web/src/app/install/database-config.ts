export type DeployMode = "local" | "docker" | "baota" | "cloud";

export const modeOptions: Array<{ label: string; value: DeployMode; host: string; ssl: boolean; description: string }> = [
    { label: "本机", value: "local", host: "localhost", ssl: false, description: "Web 与 PostgreSQL 都直接运行在当前系统，不使用 Docker；配置保存到 web/.env.local。" },
    { label: "Docker", value: "docker", host: "postgres", ssl: false, description: "Web 与项目自带 PostgreSQL 分别运行在容器中，由默认 docker-compose.yml 一起启动。" },
    { label: "宝塔", value: "baota", host: "127.0.0.1", ssl: false, description: "Web 运行在容器中，连接宝塔宿主机已经安装的 PostgreSQL；不会再启动一套数据库。" },
    { label: "云数据库", value: "cloud", host: "db.example.com", ssl: true, description: "Web 连接云厂商提供的远程 PostgreSQL，需要填写服务商地址并按要求启用 SSL。" },
];

type DatabaseConfig = {
    mode: DeployMode;
    host: string;
    port: string;
    database: string;
    username: string;
    password: string;
    ssl: boolean;
    encryptionKey: string;
    maintenanceToken: string;
};

export function generateDeploymentSecret() {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildDeploymentSnippets(config: DatabaseConfig) {
    const host = config.host.trim() || "localhost";
    const port = config.port.trim() || "5432";
    const database = config.database.trim() || "dq";
    const username = config.username.trim() || "dq";
    const databaseUrl = buildPostgresUrl({ database, host, password: config.password, port, username });
    const databaseEnv = config.mode === "docker" ? `POSTGRES_DB=${database}\nPOSTGRES_USER=${username}\nPOSTGRES_PASSWORD=${config.password}` : `DATABASE_URL=${databaseUrl}`;
    const envText = `DQ_DATABASE_PROVIDER=postgres
${databaseEnv}
DQ_DATABASE_POOL_MAX=10
DQ_DATABASE_SSL=${config.ssl ? "1" : "0"}
DQ_ENCRYPTION_KEY=${config.encryptionKey}
DQ_MAINTENANCE_TOKEN=${config.maintenanceToken}${config.mode === "baota" ? "\nDQ_TRUSTED_PROXY_HOPS=1" : ""}`;

    return {
        envText,
        composeText: config.mode === "docker" ? bundledCompose(config, database, username) : config.mode === "baota" ? baotaCompose(config, databaseUrl) : externalCompose(config, databaseUrl),
        sqlText: `psql -h ${shellArg(host)} -p ${shellArg(port)} -U postgres <<'SQL'
DO $$
BEGIN
    CREATE ROLE ${sqlIdentifier(username)} LOGIN PASSWORD ${sqlLiteral(config.password)};
EXCEPTION WHEN duplicate_object THEN
    ALTER ROLE ${sqlIdentifier(username)} WITH PASSWORD ${sqlLiteral(config.password)};
END $$;
SELECT 'CREATE DATABASE ${sqlIdentifier(database)} OWNER ${sqlIdentifier(username)}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = ${sqlLiteral(database)})\gexec
SQL`,
    };
}

function bundledCompose(config: DatabaseConfig, database: string, username: string) {
    const databaseUrl = buildPostgresUrl({ database, host: "postgres", password: config.password, port: "5432", username });
    return `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${quoteYaml(database)}
      POSTGRES_USER: ${quoteYaml(username)}
      POSTGRES_PASSWORD: ${quoteYaml(config.password)}
    volumes:
      - dq-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${username} -d ${database}"]
      interval: 5s
      timeout: 5s
      retries: 20
    restart: unless-stopped

  app:
    image: ghcr.io/ldq551945-del/dq:latest
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - dq-data:/app/web/.data
    environment:
      DQ_DATABASE_PROVIDER: "postgres"
      DATABASE_URL: ${quoteYaml(databaseUrl)}
      DQ_DATABASE_SSL: "0"
      DQ_ENCRYPTION_KEY: ${quoteYaml(config.encryptionKey)}
      DQ_MAINTENANCE_TOKEN: ${quoteYaml(config.maintenanceToken)}
    depends_on:
      postgres:
        condition: service_healthy
${appHealthcheck()}
    restart: unless-stopped

${workerService(config.maintenanceToken, "http://app:3000")}

volumes:
  dq-data:
  dq-postgres:`;
}

function externalCompose(config: DatabaseConfig, databaseUrl: string) {
    return `services:
  app:
    image: ghcr.io/ldq551945-del/dq:latest
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - dq-data:/app/web/.data
    environment:
      DQ_DATABASE_PROVIDER: "postgres"
      DATABASE_URL: ${quoteYaml(databaseUrl)}
      DQ_DATABASE_SSL: "${config.ssl ? "1" : "0"}"
      DQ_ENCRYPTION_KEY: ${quoteYaml(config.encryptionKey)}
      DQ_MAINTENANCE_TOKEN: ${quoteYaml(config.maintenanceToken)}
${appHealthcheck()}
    restart: unless-stopped

${workerService(config.maintenanceToken, "http://app:3000")}

volumes:
  dq-data:`;
}

function baotaCompose(config: DatabaseConfig, databaseUrl: string) {
    return `services:
  app:
    image: ghcr.io/ldq551945-del/dq:latest
    network_mode: host
    volumes:
      - dq-data:/app/web/.data
    environment:
      DQ_DATABASE_PROVIDER: "postgres"
      DATABASE_URL: ${quoteYaml(databaseUrl)}
      DQ_DATABASE_SSL: "0"
      DQ_ENCRYPTION_KEY: ${quoteYaml(config.encryptionKey)}
      DQ_MAINTENANCE_TOKEN: ${quoteYaml(config.maintenanceToken)}
      DQ_TRUSTED_PROXY_HOPS: "1"
${appHealthcheck()}
    restart: unless-stopped

${workerService(config.maintenanceToken, "http://127.0.0.1:3000", true)}

volumes:
  dq-data:`;
}

function appHealthcheck() {
    return `    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 10s
      retries: 5
      start_period: 30s`;
}

function workerService(maintenanceToken: string, origin: string, hostNetwork = false) {
    return `  generation-worker:
    image: ghcr.io/ldq551945-del/dq:latest
    command: ["node", "/app/web/scripts/generation-worker.mjs"]${hostNetwork ? "\n    network_mode: host" : ""}
    environment:
      DQ_WORKER_API_ORIGIN: ${origin}
      DQ_MAINTENANCE_TOKEN: ${quoteYaml(maintenanceToken)}
    depends_on:
      app:
        condition: service_healthy
    restart: unless-stopped`;
}

function buildPostgresUrl(input: { username: string; password: string; host: string; port: string; database: string }) {
    return `postgres://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${input.port}/${encodeURIComponent(input.database)}`;
}

function quoteYaml(value: string) {
    return JSON.stringify(value);
}

function shellArg(value: string) {
    return /^[a-zA-Z0-9._:/-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function sqlIdentifier(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
}

function sqlLiteral(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}
