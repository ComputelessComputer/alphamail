import { defineMiddleware } from "astro:middleware";
import { getCSPHeaders } from "./lib/security";

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();

  // Add security headers to all HTML responses
  if (response.headers.get("content-type")?.includes("text/html")) {
    const securityHeaders = getCSPHeaders();
    
    for (const [key, value] of Object.entries(securityHeaders)) {
      response.headers.set(key, value);
    }
  }

  return response;
});
