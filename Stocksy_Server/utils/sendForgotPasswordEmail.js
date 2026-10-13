// utils/sendForgotPasswordEmail.js

const transporter = require("../config/mail");
const { forgotPasswordTemplate } = require("./emailTemplates");
const { CODE_TTL_MINUTES } = require("../services/otpService");

const sendForgotPasswordEmail = async ({ email, name, otp }) => {
  await transporter.sendMail({
    from: `"Stocksy" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Reset Your Stocksy Password",
    html: forgotPasswordTemplate(name, otp, CODE_TTL_MINUTES),
  });
};

module.exports = sendForgotPasswordEmail;
