// utils/sendVerificationEmail.js
//
// The "confirm your email" code sent on signup and when an unverified
// account tries to log in.

const transporter = require("../config/mail");
const { verifyEmailTemplate } = require("./emailTemplates");
const { CODE_TTL_MINUTES } = require("../services/otpService");

const sendVerificationEmail = async ({ email, name, otp }) => {
  await transporter.sendMail({
    from: `"Stocksy" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify Your Stocksy Email",
    html: verifyEmailTemplate(name, otp, CODE_TTL_MINUTES),
  });
};

module.exports = sendVerificationEmail;
