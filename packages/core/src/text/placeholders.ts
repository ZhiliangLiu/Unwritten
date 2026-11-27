export const PLACEHOLDER_PATTERN = /\{\{protagonist\.([^{}]+)\}\}/gu;

export function placeholderToken(name: string): string {
  return `{{protagonist.${name}}}`;
}

export function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]!);
}

export function unknownPlaceholders(text: string, fieldNames: readonly string[]): string[] {
  const known = new Set(fieldNames);
  return [...new Set(placeholderNames(text).filter((name) => !known.has(name)))];
}

export function substitutePlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER_PATTERN, (match, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : match,
  );
}

export function withoutPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_PATTERN, '');
}
