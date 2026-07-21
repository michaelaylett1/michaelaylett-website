import { Resend } from "resend";
import { escapeHtml, formatTimestamp } from "./validate";

// Lazily instantiated so the module can be imported without RESEND_API_KEY
// set (e.g. during `next build`, which imports route handlers to type-check
// and trace them but does not execute request handlers).
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. Add it to your environment variables (see README.md)."
    );
  }
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

// Address every notification email is sent to. Kept as a constant per the
// project requirements rather than a mutable setting, so it can't be
// accidentally redirected via environment misconfiguration.
export const NOTIFICATION_EMAIL = "michael@michaelaylett.com";

// Resend requires a verified sending domain for production use. Until
// michaelaylett.com (or a subdomain) is verified in the Resend dashboard,
// the sandbox sender `onboarding@resend.dev` only delivers to the email
// address on the Resend account itself. See README.md "Email setup".
const DEFAULT_FROM = "Michael Aylett Website <onboarding@resend.dev>";

export type EmailField = {
  label: string;
  value: string;
};

export type EmailAttachment = {
  name: string;
  url: string;
};

export type NotificationEmailInput = {
  subject: string;
  formName: string;
  fields: EmailField[];
  files?: EmailAttachment[];
  replyTo?: string;
};

function buildHtml(input: NotificationEmailInput): string {
  const rows = input.fields
    .filter((f) => f.value.trim().length > 0)
    .map(
      (f) => `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #e6e2da;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b6459;white-space:nowrap;vertical-align:top;">${escapeHtml(
            f.label
          )}</td>
          <td style="padding:10px 16px;border-bottom:1px solid #e6e2da;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c1a16;white-space:pre-wrap;">${escapeHtml(
            f.value
          )}</td>
        </tr>`
    )
    .join("");

  const filesSection =
    input.files && input.files.length > 0
      ? `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #e6e2da;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b6459;white-space:nowrap;vertical-align:top;">Uploaded documents</td>
          <td style="padding:10px 16px;border-bottom:1px solid #e6e2da;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c1a16;">
            ${input.files
              .map(
                (file) =>
                  `<a href="${escapeHtml(
                    file.url
                  )}" style="color:#8a6a3a;">${escapeHtml(
                    file.name
                  )}</a><br/>`
              )
              .join("")}
            <span style="font-size:12px;color:#8a8478;">Secure links expire 7 days after submission.</span>
          </td>
        </tr>`
      : "";

  return `
  <div style="background:#f5f2ec;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e2da;">
      <tr>
        <td style="background:#1c1a16;padding:20px 24px;">
          <p style="margin:0;color:#c9a86a;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(
            input.formName
          )}</p>
          <h1 style="margin:6px 0 0;color:#ffffff;font-size:20px;">New submission from michaelaylett.com</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 0;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b6459;">Submitted ${escapeHtml(
            formatTimestamp()
          )}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 8px 24px;">
          <table role="presentation" width="100%" style="border-collapse:collapse;">
            ${rows}
            ${filesSection}
          </table>
        </td>
      </tr>
    </table>
  </div>`;
}

function buildText(input: NotificationEmailInput): string {
  const lines = [
    input.formName,
    `Submitted ${formatTimestamp()}`,
    "",
    ...input.fields
      .filter((f) => f.value.trim().length > 0)
      .map((f) => `${f.label}: ${f.value}`),
  ];

  if (input.files && input.files.length > 0) {
    lines.push("", "Uploaded documents:");
    for (const file of input.files) {
      lines.push(`${file.name}: ${file.url}`);
    }
    lines.push("(Secure links expire 7 days after submission.)");
  }

  return lines.join("\n");
}

export async function sendNotificationEmail(
  input: NotificationEmailInput
): Promise<void> {
  const resend = getResendClient();
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;

  const { error } = await resend.emails.send({
    from,
    to: NOTIFICATION_EMAIL,
    subject: input.subject,
    html: buildHtml(input),
    text: buildText(input),
    replyTo: input.replyTo,
  });

  if (error) {
    throw new Error(`Resend failed to send email: ${error.message}`);
  }
}
