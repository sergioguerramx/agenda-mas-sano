export const ALLOWED_ADMIN_EMAILS = ["info.mas.sano@gmail.com", "ms.suc.puentes@gmail.com"] as const;

export function isAllowedAdminEmail(email?: string | null) {
  return Boolean(email && ALLOWED_ADMIN_EMAILS.includes(email as (typeof ALLOWED_ADMIN_EMAILS)[number]));
}
