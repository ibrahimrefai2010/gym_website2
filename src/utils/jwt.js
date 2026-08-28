const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

function signAccessToken(subject) {
  return jwt.sign(
    {
      sub: Number(subject.id),
      type: subject.type,
      role: subject.type === "admin" ? subject.role : null
    },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpiry }
  );
}

function signRefreshToken(subject) {
  return jwt.sign(
    {
      sub: Number(subject.id),
      type: subject.type,
      role: subject.type === "admin" ? subject.role : null
    },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpiry }
  );
}

function signResetToken(user, jti) {
  return jwt.sign(
    {
      sub: Number(user.id),
      type: "password_reset",
      role: null,
      jti
    },
    env.jwtAccessSecret,
    { expiresIn: "10m" }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.jwtRefreshSecret);
  if (!["user", "admin"].includes(payload.type)) {
    throw new Error("Invalid refresh token type.");
  }
  return payload;
}

function verifyResetToken(token) {
  const payload = jwt.verify(token, env.jwtAccessSecret);
  if (payload.type !== "password_reset") {
    throw new Error("Invalid reset token type.");
  }
  return payload;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  signResetToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyResetToken
};
