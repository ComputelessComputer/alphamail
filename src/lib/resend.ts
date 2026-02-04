import { Resend } from "resend";

const apiKey = import.meta.env.RESEND_API_KEY;

if (!apiKey) {
  throw new Error("Missing RESEND_API_KEY environment variable");
}

export const resend = new Resend(apiKey);

// Default sender address
export const FROM_EMAIL = "Alpha <alpha@alphamail.ai>";

// Helper to send emails
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
    text,
  });

  if (error) {
    console.error("Failed to send email:", error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}
