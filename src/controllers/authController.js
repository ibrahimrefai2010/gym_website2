const authService = require("../services/authService");
const { clearRefreshCookie, refreshTokenFromRequest, setRefreshCookie } = require("../utils/cookies");

function sendSession(res, result, statusCode = 200) {
  setRefreshCookie(res, result.refreshToken, authService.REFRESH_MAX_AGE_MS);
  const { refreshToken: _refreshToken, ...data } = result;
  res.status(statusCode).json({ success: true, data });
}

async function login(req, res) {
  const result = await authService.login({
    identifier: req.body.identifier,
    password: req.body.password,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || ""
  });

  sendSession(res, result);
}

async function register(req, res) {
  const result = await authService.register(req.body, {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || ""
  });
  sendSession(res, result, 201);
}

async function refresh(req, res) {
  const result = await authService.refresh(refreshTokenFromRequest(req), {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || ""
  });
  sendSession(res, result);
}

async function logout(req, res) {
  const result = await authService.logout(refreshTokenFromRequest(req), {
    ipAddress: req.ip
  });
  clearRefreshCookie(res);
  res.json({ success: true, data: result });
}

async function forgotPassword(req, res) {
  const result = await authService.forgotPassword(req.body.identifier, {
    ipAddress: req.ip
  });
  res.json({ success: true, data: result });
}

async function verifyOtp(req, res) {
  const data = await authService.verifyOtp({
    identifier: req.body.identifier,
    otp: req.body.otp
  });
  res.json({ success: true, data });
}

async function resetPassword(req, res) {
  const data = await authService.resetPassword(
    {
      resetToken: req.body.reset_token || req.body.resetToken,
      password: req.body.password
    },
    { ipAddress: req.ip }
  );
  clearRefreshCookie(res);
  res.json({ success: true, data });
}

async function adminLogin(req, res) {
  const result = await authService.adminLogin({
    identifier: req.body.identifier || req.body.email,
    password: req.body.password,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || ""
  });
  sendSession(res, result);
}

async function adminChangePassword(req, res) {
  const data = await authService.adminChangePassword(
    {
      adminId: req.user.id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword || req.body.nextPassword
    },
    { ipAddress: req.ip }
  );
  clearRefreshCookie(res);
  res.json({ success: true, data });
}

module.exports = {
  adminChangePassword,
  adminLogin,
  forgotPassword,
  login,
  logout,
  refresh,
  register,
  resetPassword,
  verifyOtp
};
