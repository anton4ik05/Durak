import { RANK_ORDER } from "./cards";
import type { GameMode } from "./constants";
import type { Card, Rank, Suit } from "./cards";

/**
 * Бьёт ли `card` карту `against`.
 * Любой джокер бьёт любую обычную карту и не бьёт другого джокера.
 */
export function canBeat(card: Card, against: Card, trump: Suit): boolean {
  if (card.kind === "joker") return against.kind !== "joker";
  if (against.kind === "joker") return false;
  if (card.suit === against.suit) return RANK_ORDER[card.rank] > RANK_ORDER[against.rank];
  return card.suit === trump && against.suit !== trump;
}

/** Подкидывается обычная карта того номинала, что уже есть на столе. Джокер подкинуть нельзя. */
export function canThrowIn(card: Card, tableRanks: readonly Rank[]): boolean {
  if (card.kind !== "regular") return false;
  return tableRanks.includes(card.rank);
}

/** Сколько карт ещё можно подкинуть. Уже отбитые пары место в руке защитника не занимают. */
export function throwRoom(defenderCards: number, unbeatenCount: number): number {
  return Math.max(0, defenderCards - unbeatenCount);
}

/**
 * Можно ли этой картой открыть атаку.
 * Джокером ходят только за двоих. Если за столом больше игроков, джокер в атаку не кладут.
 */
export function canLead(card: Card, playerCount: number): boolean {
  if (card.kind !== "joker") return true;
  return playerCount <= 2;
}

/**
 * В партии больше чем на двоих одна карта на руках, и это джокер, — проигрыш:
 * сходить ей нельзя, руку уже не опустошить.
 */
export function losesWithLoneJoker(hand: readonly Card[], playerCount: number): boolean {
  const only = hand.length === 1 ? hand[0] : undefined;
  return playerCount > 2 && only?.kind === "joker";
}

export function tableAttackRanks(table: readonly { attack: Card }[]): Rank[] {
  const ranks: Rank[] = [];
  for (const pair of table) {
    if (pair.attack.kind === "regular" && !ranks.includes(pair.attack.rank)) {
      ranks.push(pair.attack.rank);
    }
  }
  return ranks;
}

export function nextSeatId(players: readonly { id: string; seat: number }[], fromId: string): string | null {
  if (players.length === 0) return null;
  const ordered = [...players].sort((left, right) => left.seat - right.seat);
  const index = ordered.findIndex((player) => player.id === fromId);
  if (index < 0) return null;
  return ordered[(index + 1) % ordered.length]?.id ?? null;
}

/** Соседи защитника слева и справа. Игрок без карт уже вышел — крайним становится следующий. */
export function edgePlayerIds(
  players: readonly { id: string; seat: number; cardCount?: number }[],
  defenderId: string,
): string[] {
  if (players.length === 0) return [];
  const ordered = [...players].sort((left, right) => left.seat - right.seat);
  const index = ordered.findIndex((player) => player.id === defenderId);
  if (index < 0) return [];
  const count = ordered.length;
  const inPlay = (player: { id: string; cardCount?: number } | undefined) =>
    Boolean(player && player.id !== defenderId && (player.cardCount === undefined || player.cardCount > 0));

  let previous: (typeof ordered)[number] | undefined;
  for (let step = 1; step < count; step += 1) {
    const player = ordered[(index - step + count) % count];
    if (inPlay(player)) {
      previous = player;
      break;
    }
  }
  let next: (typeof ordered)[number] | undefined;
  for (let step = 1; step < count; step += 1) {
    const player = ordered[(index + step) % count];
    if (inPlay(player)) {
      next = player;
      break;
    }
  }
  const ids: string[] = [];
  if (previous) ids.push(previous.id);
  if (next && next.id !== previous?.id) ids.push(next.id);
  return ids;
}

/** В игре 2 на 2 напарник сидит напротив: через одно место. */
export function partnerId(players: readonly { id: string; seat: number }[], playerId: string): string | null {
  if (players.length !== 4) return null;
  const ordered = [...players].sort((left, right) => left.seat - right.seat);
  const index = ordered.findIndex((player) => player.id === playerId);
  if (index < 0) return null;
  return ordered[(index + 2) % ordered.length]?.id ?? null;
}

/** Следующий может принять перевод в этом заходе. */
export function nextCanReceive(options: {
  nextId: string;
  passedIds: readonly string[];
  boutAttackerId: string;
  playerCount: number;
}): boolean {
  if (options.passedIds.includes(options.nextId)) return false;
  return !(options.nextId === options.boutAttackerId && options.playerCount > 2);
}

export interface PassContext {
  mode: GameMode;
  card: Card;
  tableRanks: readonly Rank[];
  anyBeaten: boolean;
  unbeatenCount: number;
  nextHandCount: number;
  nextCanReceive: boolean;
}

/** Перевод картой того же номинала. Карта ложится на стол. */
export function canTransfer(context: PassContext): boolean {
  if (context.mode !== "perevodnoy" || context.anyBeaten || !context.nextCanReceive) return false;
  if (context.card.kind !== "regular" || !context.tableRanks.includes(context.card.rank)) return false;
  return context.nextHandCount >= context.unbeatenCount + 1;
}

/** Свечение козырем того же номинала. Карта остаётся в руке, номинал тратится один раз. */
export function canFlash(context: PassContext & { trump: Suit; flashedRanks: readonly Rank[] }): boolean {
  if (context.mode !== "perevodnoy" || context.anyBeaten || !context.nextCanReceive) return false;
  if (context.card.kind !== "regular") return false;
  if (context.card.suit !== context.trump || !context.tableRanks.includes(context.card.rank)) return false;
  if (context.flashedRanks.includes(context.card.rank)) return false;
  return context.nextHandCount >= context.unbeatenCount;
}
