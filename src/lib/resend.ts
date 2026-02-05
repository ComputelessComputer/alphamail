import { Resend } from "resend";

const apiKey = import.meta.env.RESEND_API_KEY;

if (!apiKey) {
  throw new Error("Missing RESEND_API_KEY environment variable");
}

export const resend = new Resend(apiKey);

// Default sender address
export const FROM_EMAIL = "Alpha <alpha@bealphamail.com>";

// App URL for links
const APP_URL = import.meta.env.PUBLIC_APP_URL || "https://bealphamail.com";

// Email footer HTML
export const EMAIL_FOOTER_HTML = `
  <p style="font-size: 12px; color: #9ca3af; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
    sent via <a href="${APP_URL}" style="color: #6b7280; text-decoration: underline;">alphamail</a> ✉️
  </p>
`;

// Email footer plain text
export const EMAIL_FOOTER_TEXT = `\n\n—\nsent via alphamail ✉️\n${APP_URL}`;

// Helper to wrap email content with footer
export function wrapEmailHtml(content: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a;">
      ${content}
      ${EMAIL_FOOTER_HTML}
    </div>
  `;
}

export function wrapEmailText(content: string): string {
  return content + EMAIL_FOOTER_TEXT;
}

// Helper to send emails
export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}) {
  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
    text,
    replyTo,
  });

  if (error) {
    console.error("Failed to send email:", error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}
