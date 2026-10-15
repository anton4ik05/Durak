export const PROTOCOL_VERSION = 9;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const HAND_SIZE = 6;
export const MAX_NAME_LENGTH = 16;

export const DECK_SIZES = [36, 52] as const;
export type DeckSize = (typeof DECK_SIZES)[number];

export function isDeckSize(value: unknown): value is DeckSize {
  return value === 36 || value === 52;
}

export function deckLength(size: DeckSize, jokers: boolean): number {
  return size + (jokers ? 2 : 0);
}

export const GAME_MODES = ["podkidnoy", "perevodnoy"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export function isGameMode(value: unknown): value is GameMode {
  return value === "podkidnoy" || value === "perevodnoy";
}
