import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { Resend } from "resend";
import type { Mailer, MailMessage, MailRecipient } from "@smplat/shared";

const fromEmail = process.env.EMAIL_FROM ?? "no-reply@localhost";
const fromName = process.env.EMAIL_FROM_NAME ?? "SMPLAT";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT ? Number.parseInt(process.env.SMTP_PORT, 10) : undefined;
const smtpUser = process.env.SMTP_USER;
const smtpPassword = process.env.SMTP_PASSWORD;
const smtpSecure = process.env.SMTP_SECURE === "true";

const resendApiKey = process.env.RESEND_API_KEY;

const formatRecipient = (recipient: MailRecipient): string =>
  recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email;

const normalizeRecipients = (recipient: MailRecipient | MailRecipient[]): string[] =>
  Array.isArray(recipient) ? recipient.map(formatRecipient) : [formatRecipient(recipient)];

class SMTPMailer implements Mailer {
  private transporter: Mail;

  constructor() {
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
      throw new Error("SMTP configuration is incomplete");
    }

    const smtpConfig = {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPassword
      }
    };

    this.transporter = nodemailer.createTransport(smtpConfig);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: normalizeRecipients(message.to),
      cc: message.cc?.map(formatRecipient),
      bcc: message.bcc?.map(formatRecipient),
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers
    });
  }
}

class ResendMailer implements Mailer {
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: MailMessage): Promise<void> {
    await this.client.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: normalizeRecipients(message.to),
      cc: message.cc?.map(formatRecipient),
      bcc: message.bcc?.map(formatRecipient),
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers
    });
  }
}

class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.warn("ConsoleMailer fallback invoked. Email payload:", JSON.stringify(message, null, 2));
  }
}

let cachedMailer: Mailer | null = null;

export const getMailer = (): Mailer => {
  if (cachedMailer) {
    return cachedMailer;
  }

  if (resendApiKey) {
    cachedMailer = new ResendMailer(resendApiKey);
    return cachedMailer;
  }

  try {
    cachedMailer = new SMTPMailer();
    return cachedMailer;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("SMTP mailer misconfigured, falling back to console logger.", error);
    cachedMailer = new ConsoleMailer();
    return cachedMailer;
  }
};
