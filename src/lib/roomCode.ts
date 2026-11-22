/**
 * 32-character non-confusable room code alphabet (excludes 0, O, 1, I).
 * Must stay aligned with `public.generate_unique_room_code()` in `003_rpcs.sql`.
 */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' as const;

const ROOM_CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

/** Strips whitespace/hyphens and uppercases raw room code input before validation or RPC calls. */
export function normalizeRoomCode(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toUpperCase();
}

/** Checks whether raw input normalizes to a valid 6-character non-confusable room code. */
export function isValidRoomCode(raw: string): boolean {
  return ROOM_CODE_REGEX.test(normalizeRoomCode(raw));
}

/** Builds a deep link URI targeting `/room/join` with a validated 6-char room code. */
export function buildInviteLink(roomCode: string, scheme = 'poproom'): string {
  const normalized = normalizeRoomCode(roomCode);
  if (!ROOM_CODE_REGEX.test(normalized)) {
    throw new Error(`Invalid room code: "${roomCode}"`);
  }
  const cleanScheme = scheme.replace(/:\/\/$/, '');
  return `${cleanScheme}://room/join?code=${normalized}`;
}

/**
 * Extracts and normalizes a valid 6-character room code from a PopRoom or Expo Go join link.
 * Returns `null` for unrelated URLs, mismatched routes, or invalid room codes.
 */
export function extractRoomCodeFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const isPoproomScheme = parsed.protocol === 'poproom:';
  const isExpoDevScheme = parsed.protocol === 'exp:' || parsed.protocol === 'exps:';
  if (!isPoproomScheme && !isExpoDevScheme) {
    return null;
  }

  const routePath = `${parsed.host}${parsed.pathname}`.replace(/^\/+|\/+$/g, '');
  const isJoinRoute =
    routePath === 'room/join' ||
    (isExpoDevScheme && routePath.endsWith('/room/join'));
  if (!isJoinRoute) {
    return null;
  }

  const rawCode = parsed.searchParams.get('code');
  if (!rawCode) {
    return null;
  }

  const normalized = normalizeRoomCode(rawCode);
  return ROOM_CODE_REGEX.test(normalized) ? normalized : null;
}

/** Formats a copy-ready invitation message containing the room title, 6-char code, and link. */
export function buildShareMessage(
  roomTitle: string,
  roomCode: string,
  inviteUrl: string,
): string {
  const normalized = normalizeRoomCode(roomCode);
  const displayCode = ROOM_CODE_REGEX.test(normalized) ? normalized : roomCode.trim();
  return `邀请你加入「${roomTitle}」轻橘协作房间\n房间码：${displayCode}\n点击直达：${inviteUrl}`;
}
