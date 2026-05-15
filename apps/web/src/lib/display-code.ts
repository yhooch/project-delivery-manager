export function formatDisplayCode(prefix: string, id: string): string {
  return `${prefix}-${id.slice(-6).toUpperCase()}`;
}
