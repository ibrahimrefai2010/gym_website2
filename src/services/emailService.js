const nodemailer = require("nodemailer");
const { env } = require("../config/env");
const settingsRepository = require("../repositories/settingsRepository");
const { appLogger } = require("../utils/logger");

let transporter;

function smtpReady() {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass
      }
    });
  }
  return transporter;
}

async function otpTemplate(otp) {
  const configuredLogo = await settingsRepository.getSetting("site_logo_url", "/assets/logo.png");
  const logoUrl = /^https?:\/\//i.test(configuredLogo)
    ? configuredLogo
    : `${env.baseUrl.replace(/\/$/, "")}${configuredLogo || "/assets/logo.png"}`;
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#151515">
      <img src="${logoUrl}" alt="Muscle and Fitness Center" width="96" height="96" style="display:block;margin-bottom:16px">
      <h1 style="font-size:22px;margin:0 0 12px">Password reset code</h1>
      <p>Your Muscle and Fitness Center verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${otp}</p>
      <p>This code expires in ${env.otpExpiryMinutes} minutes. If you did not request it, ignore this email.</p>
    </div>
  `;
}

async function sendPasswordResetOtp(to, otp) {
  if (!smtpReady()) {
    appLogger.warn({ to }, "SMTP is not configured; password reset OTP was not sent.");
    return { sent: false };
  }

  try {
    await getTransporter().sendMail({
      from: env.emailFrom,
      to,
      subject: "Muscle and Fitness Center password reset code",
      text: `Your Muscle and Fitness Center verification code is ${otp}. It expires in ${env.otpExpiryMinutes} minutes.`,
      html: await otpTemplate(otp)
    });
    return { sent: true };
  } catch (error) {
    appLogger.error({ error, to }, "Password reset OTP email failed.");
    return { sent: false };
  }
}

module.exports = {
  sendPasswordResetOtp
};
