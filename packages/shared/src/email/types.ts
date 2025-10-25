export type MailRecipient = {
  email: string;
  name?: string;
};

export type MailMessage = {
  to: MailRecipient | MailRecipient[];
  subject: string;
  html: string;
  text?: string;
  cc?: MailRecipient[];
  bcc?: MailRecipient[];
  headers?: Record<string, string>;
};

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type MailerFactoryOptions = {
  fromEmail: string;
  defaultFromName?: string;
};
