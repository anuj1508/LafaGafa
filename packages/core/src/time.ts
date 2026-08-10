/**
 * Formats an instant in the business's timezone, or returns null when the platform does not know
 * the zone — an operator typo in `settings.timezone` must not take a turn down. See #precomputed.
 */
export function formatInZone(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string | null {
  if (Number.isNaN(instant.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(instant);
  } catch {
    return null;
  }
}
