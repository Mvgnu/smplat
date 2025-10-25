type VerificationEmailParams = {
  verificationUrl: string;
  recipient?: string;
};

const baseStyles = {
  container: "font-family: Arial, sans-serif; line-height: 1.6; color: #111827;",
  heading: "font-size: 20px; font-weight: 600; margin-bottom: 16px;",
  paragraph: "margin: 16px 0;",
  ctaWrapper: "text-align: center; margin: 32px 0;",
  ctaButton:
    "background-color: #111827; color: #FFFFFF; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;",
  footer: "margin-top: 32px; color: #6B7280;"
} as const;

export const renderSignInEmail = ({ verificationUrl, recipient }: VerificationEmailParams) => {
  const safeUrl = verificationUrl;
  const greetingName = recipient ? `Hi ${recipient},` : "Hello,";

  const html = `
    <div style="${baseStyles.container}">
      <h1 style="${baseStyles.heading}">Sign in to SMPLAT</h1>
      <p style="${baseStyles.paragraph}">${greetingName}</p>
      <p style="${baseStyles.paragraph}">Click the button below to complete your login. This link is valid for 15 minutes.</p>
      <div style="${baseStyles.ctaWrapper}">
        <a href="${safeUrl}" style="${baseStyles.ctaButton}">Confirm sign-in</a>
      </div>
      <p style="${baseStyles.paragraph}">If the button above does not work, copy and paste this URL into your browser:</p>
      <p style="${baseStyles.paragraph}"><a href="${safeUrl}">${safeUrl}</a></p>
      <p style="${baseStyles.footer}">If you did not request this email, you can safely ignore it.</p>
      <p style="${baseStyles.footer}">— The SMPLAT Team</p>
    </div>
  `;

  const text = `Sign in to SMPLAT by visiting ${safeUrl}`;

  return {
    subject: "Your SMPLAT sign-in link",
    html,
    text
  };
};
