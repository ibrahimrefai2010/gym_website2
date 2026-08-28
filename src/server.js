const app = require("./app");
const { env } = require("./config/env");
const { appLogger } = require("./utils/logger");

if (env.nodeEnv !== "test") {
  require("./jobs/cron");
}

const server = app.listen(env.port, () => {
  appLogger.info({ port: env.port }, `${env.appName} is running`);
});

function shutdown(signal) {
  appLogger.info({ signal }, "Closing server");
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
