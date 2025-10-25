import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import { prisma } from "../db/client";
import { getMailer } from "../email/mailer";
import { renderSignInEmail } from "@smplat/shared";
import type { DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { UserRole } from "@prisma/client";

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "database"
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const userWithRole = user as { id?: string; role?: UserRole | null };
        token.id = userWithRole.id ?? token.sub;
        if (userWithRole.role) {
          token.role = userWithRole.role;
        }
      }
      return token as JWT & { id?: string; role?: UserRole };
    },
    async session({ session, token }) {
      if (session.user) {
        const jwtToken = token as JWT & { id?: string; role?: UserRole };
        const mutableUser = session.user as DefaultSession["user"] & {
          id?: string;
          role?: UserRole;
        };
        mutableUser.id = jwtToken.id ?? jwtToken.sub ?? mutableUser.id ?? "";
        mutableUser.role = jwtToken.role ?? mutableUser.role;
      }
      return session;
    }
  },
  providers: [
    EmailProvider({
      name: "Email",
      from: process.env.EMAIL_FROM,
      server: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? Number.parseInt(process.env.SMTP_PORT, 10) : 587,
        secure: process.env.SMTP_SECURE === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD
        }
      },
      async sendVerificationRequest({ identifier, url }) {
        const mailer = getMailer();
        const { subject, html, text } = renderSignInEmail({
          verificationUrl: url,
          recipient: identifier
        });

        await mailer.send({
          to: {
            email: identifier
          },
          subject,
          html,
          text
        });
      }
    })
  ],
  pages: {
    signIn: "/login"
  }
};
