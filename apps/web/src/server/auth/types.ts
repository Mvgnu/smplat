export type UserRole = "CLIENT" | "FINANCE" | "ADMIN";
export type UserStatus = "ACTIVE" | "INVITED" | "SUSPENDED";

const ROLE_NORMALIZED: Record<string, UserRole> = {
  client: "CLIENT",
  CLIENT: "CLIENT",
  finance: "FINANCE",
  FINANCE: "FINANCE",
  admin: "ADMIN",
  ADMIN: "ADMIN"
};

const STATUS_NORMALIZED: Record<string, UserStatus> = {
  active: "ACTIVE",
  ACTIVE: "ACTIVE",
  invited: "INVITED",
  INVITED: "INVITED",
  suspended: "SUSPENDED",
  SUSPENDED: "SUSPENDED"
};

export function toFrontendRole(value: string | null | undefined): UserRole | undefined {
  if (!value) {
    return undefined;
  }
  return ROLE_NORMALIZED[value] ?? ROLE_NORMALIZED[value.toLowerCase()] ?? undefined;
}

export function toFrontendStatus(value: string | null | undefined): UserStatus | undefined {
  if (!value) {
    return undefined;
  }
  return STATUS_NORMALIZED[value] ?? STATUS_NORMALIZED[value.toLowerCase()] ?? undefined;
}

export function toApiRole(value: UserRole | null | undefined): "client" | "finance" | "admin" | undefined {
  if (!value) {
    return undefined;
  }
  return value.toLowerCase() as "client" | "finance" | "admin";
}

export function toApiStatus(
  value: UserStatus | null | undefined
): "active" | "invited" | "suspended" | undefined {
  if (!value) {
    return undefined;
  }
  return value.toLowerCase() as "active" | "invited" | "suspended";
}
