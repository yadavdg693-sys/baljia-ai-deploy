// UUID validation utility — H-SEC-003
// Validates UUID v4 format to prevent injection and invalid DB queries

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate that a string is a proper UUID v4 format.
 * Returns true if valid, false otherwise.
 */
export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Validate UUID and return it, or throw an Error if invalid.
 * Use in API route handlers before passing to service layer.
 */
export function requireUUID(value: string, paramName = 'id'): string {
  if (!isValidUUID(value)) {
    throw new Error(`Invalid UUID for ${paramName}: "${value}"`);
  }
  return value;
}
