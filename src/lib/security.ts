import { Webhook } from "svix";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

// ============================================
// Webhook Signature Verification (Resend/Svix)
// ============================================

// Support separate secrets for different webhook endpoints
const RESEND_WEBHOOK_SECRET_INBOUND = import.meta.env.RESEND_WEBHOOK_SECRET_INBOUND;
const RESEND_WEBHOOK_SECRET_EVENTS = import.meta.env.RESEND_WEBHOOK_SECRET_EVENTS;
// Fallback to single secret for backwards compatibility
const RESEND_WEBHOOK_SECRET = import.meta.env.RESEND_WEBHOOK_SECRET;

export type WebhookEndpoint = "inbound" | "events";

export interface WebhookVerificationResult {
  verified: boolean;
  payload?: any;
  error?: string;
}

/**
 * Get the appropriate webhook secret for an endpoint
 */
function getWebhookSecret(endpoint: WebhookEndpoint): string | undefined {
  if (endpoint === "inbound") {
    return RESEND_WEBHOOK_SECRET_INBOUND || RESEND_WEBHOOK_SECRET;
  }
  return RESEND_WEBHOOK_SECRET_EVENTS || RESEND_WEBHOOK_SECRET;
}

/**
 * Verify Resend webhook signature using Svix
 * IMPORTANT: Must use raw request body (string), not parsed JSON
 * @param endpoint Which webhook endpoint is being verified ("inbound" or "events")
 */
export async function verifyResendWebhook(
  rawBody: string,
  headers: Headers,
  endpoint: WebhookEndpoint = "inbound"
): Promise<WebhookVerificationResult> {
  const secret = getWebhookSecret(endpoint);
  
  if (!secret) {
    console.warn(`Webhook secret not configured for ${endpoint} - skipping verification`);
    // In development, allow unverified webhooks with a warning
    try {
      return { verified: true, payload: JSON.parse(rawBody) };
    } catch {
      return { verified: false, error: "Invalid JSON payload" };
    }
  }

  try {
    const wh = new Webhook(secret);
    
    const svixHeaders = {
      "svix-id": headers.get("svix-id") || "",
      "svix-timestamp": headers.get("svix-timestamp") || "",
      "svix-signature": headers.get("svix-signature") || "",
    };

    // Throws on invalid signature
    const payload = wh.verify(rawBody, svixHeaders);
    return { verified: true, payload };
  } catch (error: any) {
    console.error(`Webhook verification failed for ${endpoint}:`, error.message);
    return { verified: false, error: "Invalid webhook signature" };
  }
}

// ============================================
// Rate Limiting (Upstash Redis)
// ============================================

// Support both Vercel KV naming and direct Upstash naming
const UPSTASH_REDIS_URL = import.meta.env.KV_REST_API_URL || import.meta.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_TOKEN = import.meta.env.KV_REST_API_TOKEN || import.meta.env.UPSTASH_REDIS_REST_TOKEN;

let ratelimitInstance: Ratelimit | null = null;
let strictRatelimitInstance: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (!UPSTASH_REDIS_URL || !UPSTASH_REDIS_TOKEN) {
    return null;
  }

  if (!ratelimitInstance) {
    const redis = new Redis({
      url: UPSTASH_REDIS_URL,
      token: UPSTASH_REDIS_TOKEN,
    });

    // Standard rate limit: 60 requests per minute
    ratelimitInstance = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      analytics: true,
      prefix: "alphamail:ratelimit",
    });
  }

  return ratelimitInstance;
}

function getStrictRatelimit(): Ratelimit | null {
  if (!UPSTASH_REDIS_URL || !UPSTASH_REDIS_TOKEN) {
    return null;
  }

  if (!strictRatelimitInstance) {
    const redis = new Redis({
      url: UPSTASH_REDIS_URL,
      token: UPSTASH_REDIS_TOKEN,
    });

    // Strict rate limit for sensitive operations: 10 requests per minute
    strictRatelimitInstance = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      analytics: true,
      prefix: "alphamail:ratelimit:strict",
    });
  }

  return strictRatelimitInstance;
}

export interface RateLimitResult {
  success: boolean;
  limit?: number;
  remaining?: number;
  reset?: number;
}

/**
 * Check rate limit for a given identifier (usually IP or user ID)
 */
export async function checkRateLimit(
  identifier: string,
  strict: boolean = false
): Promise<RateLimitResult> {
  const limiter = strict ? getStrictRatelimit() : getRatelimit();
  
  if (!limiter) {
    // Rate limiting not configured - allow request
    return { success: true };
  }

  try {
    const { success, limit, remaining, reset } = await limiter.limit(identifier);
    return { success, limit, remaining, reset };
  } catch (error) {
    console.error("Rate limit check failed:", error);
    // On error, allow the request (fail open for availability)
    return { success: true };
  }
}

/**
 * Get client IP from request headers
 */
export function getClientIP(request: Request): string {
  // Vercel/Cloudflare headers
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  
  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }

  // Fallback
  return "unknown";
}

// ============================================
// Input Validation
// ============================================

export interface ValidationResult {
  valid: boolean;
  sanitized?: string;
  error?: string;
}

// Maximum lengths for different field types
const MAX_LENGTHS = {
  firstName: 50,
  lastName: 50,
  goalDescription: 500,
  emailContent: 50000, // 50KB max for email content
  subject: 200,
};

/**
 * Validate and sanitize a first name
 */
export function validateFirstName(input: string | null | undefined): ValidationResult {
  if (!input || typeof input !== "string") {
    return { valid: false, error: "First name is required" };
  }

  const trimmed = input.trim();
  
  if (trimmed.length === 0) {
    return { valid: false, error: "First name cannot be empty" };
  }

  if (trimmed.length > MAX_LENGTHS.firstName) {
    return { valid: false, error: `First name must be ${MAX_LENGTHS.firstName} characters or less` };
  }

  // Remove potentially dangerous characters but allow unicode letters
  // Allow letters, spaces, hyphens, apostrophes
  const sanitized = trimmed
    .replace(/[<>\"'`\\]/g, "") // Remove HTML/script dangerous chars
    .replace(/[\x00-\x1F\x7F]/g, ""); // Remove control characters

  if (sanitized.length === 0) {
    return { valid: false, error: "First name contains invalid characters" };
  }

  return { valid: true, sanitized };
}

/**
 * Validate and sanitize a goal description
 */
export function validateGoalDescription(input: string | null | undefined): ValidationResult {
  if (!input || typeof input !== "string") {
    return { valid: false, error: "Goal description is required" };
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: "Goal description cannot be empty" };
  }

  if (trimmed.length > MAX_LENGTHS.goalDescription) {
    return { valid: false, error: `Goal must be ${MAX_LENGTHS.goalDescription} characters or less` };
  }

  // Less restrictive for goals - just remove control characters
  const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, "");

  return { valid: true, sanitized };
}

/**
 * Validate email content (from inbound emails)
 */
export function validateEmailContent(input: string | null | undefined): ValidationResult {
  if (!input || typeof input !== "string") {
    return { valid: true, sanitized: "" }; // Empty is allowed
  }

  if (input.length > MAX_LENGTHS.emailContent) {
    // Truncate rather than reject
    const truncated = input.substring(0, MAX_LENGTHS.emailContent);
    return { valid: true, sanitized: truncated };
  }

  // Remove null bytes and other dangerous control characters
  const sanitized = input.replace(/\x00/g, "");

  return { valid: true, sanitized };
}

/**
 * Validate email subject
 */
export function validateSubject(input: string | null | undefined): ValidationResult {
  if (!input || typeof input !== "string") {
    return { valid: true, sanitized: "No subject" };
  }

  const trimmed = input.trim();

  if (trimmed.length > MAX_LENGTHS.subject) {
    return { valid: true, sanitized: trimmed.substring(0, MAX_LENGTHS.subject) };
  }

  const sanitized = trimmed.replace(/[\x00-\x1F\x7F]/g, "");

  return { valid: true, sanitized: sanitized || "No subject" };
}

// ============================================
// CSRF Protection
// ============================================

const CSRF_SECRET = import.meta.env.CSRF_SECRET || crypto.randomBytes(32).toString("hex");

/**
 * Generate a CSRF token for a given session/user
 */
export function generateCSRFToken(sessionId: string): string {
  const timestamp = Date.now().toString();
  const data = `${sessionId}:${timestamp}`;
  const signature = crypto
    .createHmac("sha256", CSRF_SECRET)
    .update(data)
    .digest("hex");
  
  // Token format: timestamp.signature
  return Buffer.from(`${timestamp}.${signature}`).toString("base64");
}

/**
 * Verify a CSRF token
 * @param token The token to verify
 * @param sessionId The session ID that was used to generate the token
 * @param maxAgeMs Maximum age of the token in milliseconds (default 1 hour)
 */
export function verifyCSRFToken(
  token: string,
  sessionId: string,
  maxAgeMs: number = 3600000
): boolean {
  try {
    const decoded = Buffer.from(token, "base64").toString();
    const [timestamp, signature] = decoded.split(".");

    if (!timestamp || !signature) {
      return false;
    }

    // Check token age
    const tokenAge = Date.now() - parseInt(timestamp, 10);
    if (tokenAge > maxAgeMs || tokenAge < 0) {
      return false;
    }

    // Verify signature
    const data = `${sessionId}:${timestamp}`;
    const expectedSignature = crypto
      .createHmac("sha256", CSRF_SECRET)
      .update(data)
      .digest("hex");

    // Timing-safe comparison
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// ============================================
// Audit Logging
// ============================================

export type AuditEventType =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.logout"
  | "auth.signup"
  | "account.delete"
  | "account.delete.attempt"
  | "api.rate_limited"
  | "webhook.invalid_signature"
  | "security.csrf_failure"
  | "security.input_validation_failure";

export interface AuditLogEntry {
  timestamp: string;
  event: AuditEventType;
  userId?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  details?: Record<string, any>;
}

/**
 * Log a security-relevant event
 * In production, this could send to a logging service (e.g., Datadog, Logtail)
 */
export function auditLog(
  event: AuditEventType,
  request: Request,
  options: {
    userId?: string;
    email?: string;
    details?: Record<string, any>;
  } = {}
): void {
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    event,
    userId: options.userId,
    email: options.email,
    ip: getClientIP(request),
    userAgent: request.headers.get("user-agent") || undefined,
    details: options.details,
  };

  // Log to console in a structured format
  // In production, you'd send this to a logging service
  console.log("[AUDIT]", JSON.stringify(entry));

  // TODO: In production, send to external logging service
  // Example: await sendToLoggingService(entry);
}

// ============================================
// Content Security Policy
// ============================================

/**
 * Generate CSP headers for the application
 */
export function getCSPHeaders(): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com", // Stripe for payments if needed
    "style-src 'self' 'unsafe-inline'", // Allow inline styles for Astro
    "img-src 'self' data: https:", // Allow images from https sources
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
    "frame-src 'self' https://js.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}
