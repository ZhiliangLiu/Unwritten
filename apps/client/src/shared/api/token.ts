let token: string | null = null;

export function readToken(): string | null {
  if (token) return token;
  const value = new URLSearchParams(location.hash.replace(/^#/, '')).get('token');
  token = value;
  if (value && !import.meta.env.DEV) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
  return token;
}

export function currentToken(): string | null {
  return token;
}
