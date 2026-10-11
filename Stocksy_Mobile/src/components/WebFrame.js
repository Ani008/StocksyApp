import React from "react";

/**
 * Native: no frame, children render exactly as before.
 * (On web, Metro picks WebFrame.web.js instead.)
 */
export default function WebFrame({ children }) {
  return children;
}
