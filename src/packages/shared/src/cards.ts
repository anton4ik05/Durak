import type { DeckSize } from "./constants";

export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export const LOW_RANKS = ["2", "3", "4", "5"] as const;
export const HIGH_RANKS = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export const RANKS = [...LOW_RANKS, ...HIGH_RANKS] as const;
export const JOKER_COLORS = ["black", "red"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type JokerColor = (typeof JOKER_COLORS)[number];

export interface RegularCard {
  kind: "regular";
  suit: Suit;
  rank: Rank;
}

export interface JokerCard {
  kind: "joker";
  color: JokerColor;
}

export type Card = RegularCard | JokerCard;

export interface DeckOptions {
  size: DeckSize;
  jokers: boolean;
}

export const RANK_ORDER: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function cardKey(card: Card): string {
  if (card.kind === "joker") return `joker:${card.color}`;
  return `${card.suit}:${card.rank}`;
}

export function isSuit(value: unknown): value is Suit {
  return typeof value === "string" && (SUITS as readonly string[]).includes(value);
}

export function isRank(value: unknown): value is Rank {
  return typeof value === "string" && (RANKS as readonly string[]).includes(value);
}

export function isJokerColor(value: unknown): value is JokerColor {
  return value === "black" || value === "red";
}

export function isRegularCard(value: unknown): value is RegularCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Record<string, unknown>;
  return card.kind === "regular" && isSuit(card.suit) && isRank(card.rank);
}

export function isCard(value: unknown): value is Card {
  if (!value || typeof value !== "object") return false;
  const card = value as Record<string, unknown>;
  if (card.kind === "joker") return isJokerColor(card.color);
  return isRegularCard(value);
}

export function createDeck(options: DeckOptions): Card[] {
  const ranks = options.size === 52 ? RANKS : HIGH_RANKS;
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of ranks) {
      deck.push({ kind: "regular", suit, rank });
    }
  }
  if (options.jokers) {
    deck.push({ kind: "joker", color: "black" });
    deck.push({ kind: "joker", color: "red" });
  }
  return deck;
}

/**
 * Козырем может быть только обычная карта.
 * Если снизу колоды джокер, на его место ставится ближайшая карта с мастью.
 */
export function settleTrump(deck: Card[]): Suit {
  const index = deck.findIndex((card) => card.kind === "regular");
  const card = index >= 0 ? deck[index] : undefined;
  if (!card || card.kind !== "regular") throw new Error("no trump");
  if (index > 0) {
    deck.splice(index, 1);
    deck.unshift(card);
  }
  return card.suit;
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const current = next[index] as T;
    next[index] = next[swap] as T;
    next[swap] = current;
  }
  return next;
}

/**
 * Одинаковые номиналы рядом, чтобы их было видно для атаки и подкидывания.
 * Козырь того же номинала стоит в конце группы, джокеры справа.
 */
export function sortHand(hand: readonly Card[], trump: Suit): Card[] {
  return [...hand].sort((left, right) => {
    const leftKey = sortKey(left, trump);
    const rightKey = sortKey(right, trump);
    for (let index = 0; index < leftKey.length; index += 1) {
      const diff = leftKey[index]! - rightKey[index]!;
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

const RANK_FACE: Record<Rank, string> = {
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

const SUIT_FACE: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

/** Короткая подпись карты: «6♠» или «красный джокер». */
export function cardLabel(card: Card): string {
  if (card.kind === "joker") return card.color === "red" ? "красный джокер" : "чёрный джокер";
  return `${RANK_FACE[card.rank]}${SUIT_FACE[card.suit]}`;
}

/** Список карт через запятую, последний пункт через «и». */
export function cardListLabel(cards: readonly Card[]): string {
  const labels = cards.map((card) => cardLabel(card));
  if (labels.length <= 1) return labels[0] ?? "";
  const last = labels[labels.length - 1];
  if (labels.length === 2) return `${labels[0]} и ${last}`;
  return `${labels.slice(0, -1).join(", ")} и ${last}`;
}

function sortKey(card: Card, trump: Suit): readonly [number, number, number] {
  if (card.kind === "joker") return [100, card.color === "red" ? 1 : 0, 0];
  return [RANK_ORDER[card.rank], card.suit === trump ? 1 : 0, SUITS.indexOf(card.suit)];
}
