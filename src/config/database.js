const mysql = require("mysql2/promise");
const { env } = require("./env");

let pool;

function hasDatabaseConfig() {
  return Boolean(env.databaseUrl || (env.dbHost && env.dbUser && env.dbName));
}

function getPool() {
  if (!hasDatabaseConfig()) {
    return null;
  }

  if (!pool) {
    const common = {
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: false,
      timezone: "Z"
    };

    pool = env.databaseUrl
      ? mysql.createPool({
          uri: env.databaseUrl,
          ...common
        })
      : mysql.createPool({
          host: env.dbHost,
          port: env.dbPort,
          user: env.dbUser,
          password: env.dbPassword,
          database: env.dbName,
          ...common
        });

    pool.on("connection", (connection) => {
      connection.query("SET time_zone = '+00:00'");
    });
  }

  return pool;
}

async function query(sql, params = []) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error("Database is not configured.");
  }

  const [rows] = await activePool.execute(sql, params);
  return rows;
}

async function transaction(work) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error("Database is not configured.");
  }

  const connection = await activePool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getPool,
  hasDatabaseConfig,
  query,
  transaction
};
