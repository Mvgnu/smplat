import { DefaultSession } from "next-auth";
import type { UserRole } from "@/server/auth/types";

declare module "next-auth" {
  interface Session {
    user: (DefaultSession["user"] & {
      id: string;
      role?: UserRole;
      permissions?: string[];
    }) | null;
    security?: {
      deviceBinding: {
        valid: boolean;
        fingerprint: string | null;
        ip: string | null;
        userAgent: string | null;
      };
      lockout: {
        threshold: number;
        windowMinutes: number;
      };
    };
  }

  interface User {
    id: string;
    role?: UserRole;
    permissions?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    permissions?: string[];
    deviceFingerprint?: string | null;
    deviceIp?: string | null;
    deviceUserAgent?: string | null;
    deviceMismatch?: boolean;
    lockoutThreshold?: number;
    lockoutWindowMinutes?: number;
  }
}
