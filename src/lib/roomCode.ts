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

const EMBEDDED_INVITE_URL_REGEX = /\b(?:poproom|exps?):\/\/[^\s"'<>]+/gi;
const ROOM_CODE_LABEL_REGEX = /房间码\s*[:：]?\s*([0-9A-Za-z-]{6,10})/i;

/**
 * Extracts a valid 6-char PopRoom code from copied invitation text or deep-link URLs.
 * Intentionally strict (requires a PopRoom/Expo join URL or explicit `房间码：` label)
 * so unrelated 6-character words in the user's clipboard never trigger false positives.
 */
export function extractRoomCodeFromText(raw: string): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const directUrlCode = extractRoomCodeFromUrl(trimmed);
  if (directUrlCode) {
    return directUrlCode;
  }

  const urlMatches = trimmed.match(EMBEDDED_INVITE_URL_REGEX) ?? [];
  for (const candidateUrl of urlMatches) {
    const cleaned = candidateUrl.replace(/[),.;!?，。；！？]+$/u, '');
    const code = extractRoomCodeFromUrl(cleaned);
    if (code) {
      return code;
    }
  }

  const labelMatch = trimmed.match(ROOM_CODE_LABEL_REGEX);
  if (labelMatch?.[1]) {
    const normalized = normalizeRoomCode(labelMatch[1]);
    if (ROOM_CODE_REGEX.test(normalized)) {
      return normalized;
    }
  }

  return null;
}

/**
 * Normalizes text typed or pasted into a room-code input box:
 * if a full share message or PopRoom/Expo join URL is pasted, auto-extracts the clean 6-char code;
 * otherwise preserves uppercased typing up to 12 characters.
 */
export function extractRoomCodeForInput(raw: string): string {
  const extracted = extractRoomCodeFromText(raw);
  if (extracted) {
    return extracted;
  }
  return raw.toUpperCase().slice(0, 12);
}
