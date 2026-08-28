const { env } = require("../config/env");

function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

function errorHandler(error, _req, res, _next) {
  const statusCode = error.statusCode || 500;
  const payload = {
    success: false,
    error: statusCode === 500 ? "An unexpected error occurred." : error.message
  };

  if (env.nodeEnv !== "production" && statusCode === 500) {
    payload.detail = error.message;
  }

  res.status(statusCode).json(payload);
}

module.exports = {
  errorHandler,
  notFound
};
