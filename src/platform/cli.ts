import { startPlatformServer } from "./server.js";

const config = {
  port: parseInt(process.env.PLATFORM_PORT || "3000"),
  db: {
    connectionString: process.env.DATABASE_URL || "postgres://localhost:5432/openclaw_platform",
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || "development-secret-change-in-production",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
    refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || "12"),
  },
  containers: {
    networkName: process.env.CONTAINER_NETWORK || "openclaw-orgs",
    baseImage: process.env.CONTAINER_BASE_IMAGE || "openclaw:local",
    portRangeStart: parseInt(process.env.CONTAINER_PORT_RANGE_START || "19000"),
    portRangeEnd: parseInt(process.env.CONTAINER_PORT_RANGE_END || "19999"),
    dataDir: process.env.CONTAINER_DATA_DIR || "/data/orgs",
    cpuLimit: process.env.CONTAINER_CPU_LIMIT,
    memoryLimit: process.env.CONTAINER_MEMORY_LIMIT,
  },
  proxy: {
    timeout: parseInt(process.env.PROXY_TIMEOUT || "30000"),
    maxRetries: parseInt(process.env.PROXY_MAX_RETRIES || "3"),
    retryDelay: parseInt(process.env.PROXY_RETRY_DELAY || "1000"),
  },
  health: {
    checkIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL || "30000"),
    unhealthyThreshold: parseInt(process.env.HEALTH_UNHEALTHY_THRESHOLD || "3"),
    autoRestart: process.env.HEALTH_AUTO_RESTART !== "false",
  },
};

async function main() {
  console.log("Starting OpenClaw Platform Server...");
  console.log(`Port: ${config.port}`);
  console.log(`Database: ${config.db.connectionString.replace(/:[^:@]+@/, ":***@")}`);

  const server = await startPlatformServer(config);

  await server.start();

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Failed to start platform server:", error);
  process.exit(1);
});
