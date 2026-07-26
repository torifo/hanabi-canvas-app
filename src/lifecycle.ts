export function resolveMuted(userMuted: boolean, documentHidden: boolean): boolean {
  return userMuted || documentHidden;
}

export function shouldDisposeOnPageHide(persisted: boolean): boolean {
  return !persisted;
}

export function resolvePresenceUrl(
  configuredUrl: string | undefined,
  production: boolean,
  protocol: string,
  host: string
): string | null {
  const configured = configuredUrl?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      return url.protocol === 'ws:' || url.protocol === 'wss:' ? url.href : null;
    } catch {
      return null;
    }
  }
  if (!production || !host || protocol === 'file:') return null;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/ws`;
}
