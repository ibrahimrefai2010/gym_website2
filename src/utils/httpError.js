class HttpError extends Error {
  constructor(statusCode, message, code = "HTTP_ERROR") {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createHttpError(statusCode, message, code) {
  return new HttpError(statusCode, message, code);
}

module.exports = { HttpError, createHttpError };
