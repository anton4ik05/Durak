import type { DeckSize, GameMode, GamePhase, Rank, SeatRole, Suit } from "@durka/shared";

export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export const SUIT_NAME: Record<Suit, string> = {
  spades: "пики",
  hearts: "черви",
  diamonds: "бубны",
  clubs: "трефы",
};

export const RANK_LABEL: Record<Rank, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  J: "В",
  Q: "Д",
  K: "К",
  A: "Т",
};

export function modeCaption(mode: GameMode): string {
  return mode === "perevodnoy" ? "переводной" : "подкидной";
}

export function deckCaption(size: DeckSize, jokers: boolean): string {
  const base = size === 52 ? "52 карты, от двойки" : "36 карт, от шестёрки";
  return jokers ? `${base}, с джокерами` : base;
}

export const ROLE_LABEL: Record<SeatRole, string> = {
  attacker: "ходит",
  defender: "отбивается",
  idle: "ждёт",
};

export const PHASE_LABEL: Record<GamePhase, string> = {
  attack: "Атака",
  defend: "Защита",
  throw_in: "Подкидывание",
  draw: "Добор",
  finished: "Конец партии",
};

export function isRedSuit(suit: Suit): boolean {
  return suit === "hearts" || suit === "diamonds";
}
