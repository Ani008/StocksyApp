const bcrypt = require("bcryptjs");
const { pool } = require("../config/postgres");
const { startSession } = require("./session");

const signupUser = async (req, res) => {
  console.log("\n───────────────────────────────────────");
  // SECURITY: never log req.body here — it contains the plaintext password.
  // Log only which fields are missing, never their values.
  console.log("[SIGNUP] Request received");

  const { fullName, email, password } = req.body;

  if (!fullName || !email || !password) {
    console.log(
      "[SIGNUP] ❌ Missing fields:",
      [
        !fullName && "fullName",
        !email && "email",
        !password && "password",
      ]
        .filter(Boolean)
        .join(", "),
    );
    return res
      .status(400)
      .json({
        message: "fullName, email and password are all required",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
  }

  const username = fullName.trim().split(" ")[0];
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    console.log("[SIGNUP] Checking if user already exists...");
    const existing = await pool.query(
      `
SELECT *
FROM users
WHERE email=$1
`,
      [email],
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({
        message: "An account with this email already exists.",
        code: "EMAIL_ALREADY_EXISTS",
        severity: "error",
      });
    }

    console.log("[SIGNUP] Creating new user...");
    const result = await pool.query(
      `
INSERT INTO users(

full_name,
username,
email,
password

)

VALUES($1,$2,$3,$4)

RETURNING *
`,

      [fullName, username, email, hashedPassword],
    );

    const user = result.rows[0];
    console.log("[SIGNUP] ✅ User created:", user.id);

    // Web: tokens go in HttpOnly cookies. Native: token + refreshToken in the body.
    res.status(201).json(await startSession(req, res, user));
  } catch (error) {
    // message only — the full pg error object includes row values
    // (e.g. the email in a "duplicate key" detail).
    console.error("[SIGNUP] ❌ Error:", error.message);
    res.status(500).json({
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

const loginUser = async (req, res) => {
  console.log("\n───────────────────────────────────────");
  // SECURITY: never log req.body here — it contains the plaintext password.
  console.log("[LOGIN] Request received");

  const { email, password } = req.body;

  if (!email || !password) {
    console.log(
      "[LOGIN] ❌ Missing fields:",
      [!email && "email", !password && "password"].filter(Boolean).join(", "),
    );
    return res.status(400).json({
      message: "email and password are required",
      code: "VALIDATION_ERROR",
      severity: "error",
    });
  }

  try {
    const result = await pool.query(
      `
SELECT *
FROM users
WHERE email=$1
`,

      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
        severity: "error",
      });
    }

    const user = result.rows[0];

    console.log("[LOGIN] User found:", user.id, "— checking password...");
    const isMatch = await bcrypt.compare(
      password,

      user.password,
    );
    console.log("[LOGIN] Password match:", isMatch);

    if (isMatch) {
      console.log("[LOGIN] ✅ Login successful for:", user.username);
      res.json(await startSession(req, res, user));
    } else {
      console.log("[LOGIN] ❌ Password did not match");
      res.status(401).json({
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
        severity: "error",
      });
    }
  } catch (error) {
    console.error("[LOGIN] ❌ Error:", error.message);
    res.status(500).json({
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

module.exports = {
  signupUser,
  loginUser,
};