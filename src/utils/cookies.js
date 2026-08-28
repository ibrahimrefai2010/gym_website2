const { env } = require("../config/env");

const REFRESH_COOKIE = "refresh_token";

function parseCookies(header = "") {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index === -1) {
        return cookies;
      }
      let key;
      let value;
      try {
        key = decodeURIComponent(part.slice(0, index).trim());
        value = decodeURIComponent(part.slice(index + 1).trim());
      } catch (_error) {
        return cookies;
      }
      cookies[key] = value;
      return cookies;
    }, {});
}

function refreshTokenFromRequest(req) {
  return parseCookies(req.get("cookie") || "")[REFRESH_COOKIE] || "";
}

function setRefreshCookie(res, token, maxAgeMs) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    maxAge: maxAgeMs,
    path: "/api/v1"
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/api/v1"
  });
}

module.exports = {
  clearRefreshCookie,
  refreshTokenFromRequest,
  setRefreshCookie
};
