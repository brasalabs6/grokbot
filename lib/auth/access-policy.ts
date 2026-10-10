/** Internal-only accounts: deployment without an allowlist fails closed. */
export function isInternalEmailAllowed(
  email: string,
  configured = process.env.GROKBOT_ALLOWED_EMAILS
): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !configured?.trim()) {
    return false;
  }
  return configured
    .split(",")
    .some((entry) => entry.trim().toLowerCase() === normalized);
}
