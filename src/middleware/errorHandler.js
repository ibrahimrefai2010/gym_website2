const { env } = require("../config/env");

function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

const path = require("path");

function errorHandler(error, req, res, _next) {
  const statusCode = error.statusCode || 500;
  // A website page (not the API) that crashed gets the branded 500 page.
  if (statusCode >= 500 && !String(req.originalUrl || "").startsWith("/api/") && (req.accepts(["html", "json"]) === "html")) {
    return res.status(500).sendFile(path.join(__dirname, "..", "..", "public", "500.html"));
  }
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
