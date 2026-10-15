import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RANK_ORDER, canBeat, cardKey, deckLength } from "@durka/shared";
import type { Card, DeckSize, GameMode, RegularCard, Suit } from "@durka/shared";
import { DurakGame } from "./engine";
import type { ApplyResult } from "./engine";

interface GameOptions {
  mode?: GameMode;
  jokers?: boolean;
  size?: DeckSize;
  pairs?: boolean;
}

/** Детерминированный генератор: {0..1}, как у Math.random. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Игроки p0..pN-1, места совпадают с индексом в имени. */
function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `p${index}`);
}

const DEFAULT_OPTIONS: GameOptions = { mode: "podkidnoy", jokers: false, size: 36, pairs: false };

/**
 * Новая партия с подменённым Math.random: раздача детерминирована, но
 * отличается от реальной игры только порядком карт и козыря.
 */
function newGame(seed: number, count: number, options: GameOptions = {}): DurakGame {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const random = mulberry32(seed);
  const original = Math.random;
  Math.random = random;
  try {
    return new DurakGame(
      ids(count).map((id, index) => ({ id, name: `Игрок ${index + 1}`, connected: true })),
      { size: opts.size ?? 36, jokers: opts.jokers ?? false, mode: opts.mode ?? "podkidnoy", ...(opts.pairs ? { pairs: true } : {}) },
    );
  } finally {
    Math.random = original;
  }
}

/** Ищет раздачу, при которой выполняется условие. Инварианты теста — из условия, не из конкретного сида. */
function findGame(
  count: number,
  options: GameOptions,
  match: (game: DurakGame) => boolean,
  tries = 2000,
): DurakGame {
  for (let seed = 0; seed < tries; seed += 1) {
    const game = newGame(seed, count, options);
    if (match(game)) return game;
  }
  throw new Error("не найдена раздача для сценария");
}

const publicState = (game: DurakGame) => game.viewFor("p0").public;
const handOf = (game: DurakGame, playerId: string) => game.viewFor(playerId).hand;

/** Самая младшая козырная карта в руке, если есть. */
function lowestTrump(hand: Card[], trump: Suit): RegularCard | null {
  let best: RegularCard | null = null;
  for (const card of hand) {
    if (card.kind === "regular" && card.suit === trump && (!best || RANK_ORDER[card.rank] < RANK_ORDER[best.rank])) {
      best = card;
    }
  }
  return best;
}

function firstRegular(hand: Card[]): RegularCard | null {
  for (const card of hand) if (card.kind === "regular") return card;
  return null;
}

function canBeatCard(hand: Card[], attack: Card, trump: Suit): Card | undefined {
  return hand.find((card) => canBeat(card, attack, trump));
}

/**
 * Пара для свечения: небиткая карта атакующего и козырная того же номинала
 * у защитника. Ищем по любой карте атакующего, а не по конкретной.
 */
function flashPair(game: DurakGame): { lead: RegularCard; trumper: RegularCard } | null {
  const st = publicState(game);
  const attackerHand = handOf(game, st.attackerId);
  const defenderHand = handOf(game, st.defenderId);
  for (const card of attackerHand) {
    if (card.kind !== "regular" || card.suit === st.trump) continue;
    const trumper = defenderHand.find(
      (item) => item.kind === "regular" && item.suit === st.trump && item.rank === card.rank,
    );
    if (trumper?.kind === "regular") return { lead: card, trumper };
  }
  return null;
}

function expectOk(result: ApplyResult): void {
  if (!result.ok) assert.fail(result.message);
}

function expectIllegal(result: ApplyResult, pattern: RegExp): void {
  if (result.ok) assert.fail(`ожидался отказ, но ход принят`);
  assert.match(result.message, pattern);
}

/** Сумма всех карт в партии не должна меняться. */
function conservation(game: DurakGame, count: number): number {
  const st = publicState(game);
  let sum = st.deckCount + st.discardCount;
  for (const pair of st.table) {
    sum += 1;
    if (pair.defense) sum += 1;
  }
  for (const id of ids(count)) sum += handOf(game, id).length;
  return sum;
}

/** Гоняет партию до конца простой политикой: атака младшей картой, защита по возможности, иначе взятие. */
function playUntilOver(game: DurakGame, count: number, total: number, maxSteps = 500): number {
  let step = 0;
  for (; step < maxSteps; step += 1) {
    const st = publicState(game);
    assert.equal(conservation(game, count), total, `карты пропадают на шаге ${step}`);
    if (st.phase === "finished") return step;
    if (game.wantsAutoClose()) {
      game.finishAutoClose();
      continue;
    }
    if (st.phase === "attack") {
      const card = firstRegular(handOf(game, st.attackerId));
      assert.ok(card, "атакующему нечем ходить");
      expectOk(game.apply(st.attackerId, { type: "attack", cards: [card] }));
    } else if (st.phase === "defend") {
      const pair = st.table.find((item) => item.defense === null);
      assert.ok(pair, "в фазе отбоя нет открытой карты");
      const beat = canBeatCard(handOf(game, st.defenderId), pair.attack, st.trump);
      const result = beat
        ? game.apply(st.defenderId, { type: "defend", card: beat, against: pair.attack })
        : game.apply(st.defenderId, { type: "take" });
      expectOk(result);
    } else if (st.phase === "throw_in") {
      for (const id of ids(count)) {
        if (id !== st.defenderId) game.apply(id, { type: "done" });
      }
      assert.notEqual(publicState(game).phase, "throw_in", "«бито» не закрыло взятие");
    } else {
      throw new Error(`неожиданная фаза ${st.phase}`);
    }
  }
  throw new Error("партия не доиграла за отведённые шаги");
}

describe("создание партии", () => {
  it("раздаёт по 6 карт и кладёт остаток в колоду", () => {
    const game = newGame(7, 3);
    const st = publicState(game);
    assert.equal(st.phase, "attack");
    assert.deepEqual(st.table, []);
    for (const id of ids(3)) assert.equal(handOf(game, id).length, 6);
    assert.equal(st.deckCount, deckLength(36, false) - 18);
    assert.equal(conservation(game, 3), 36);
  });

  it("первым ходит владелец младшего козыря", () => {
    const game = findGame(3, {}, (g) => lowestTrump(handOf(g, publicState(g).attackerId), publicState(g).trump) !== null);
    const st = publicState(game);
    const trump = st.trump;
    const best = lowestTrump(handOf(game, st.attackerId), trump);
    assert.ok(best, "атакующий обязан иметь козырную карту");
    const anyLower = ids(3).some((id) =>
      handOf(game, id).some(
        (card) => card.kind === "regular" && card.suit === trump && RANK_ORDER[card.rank] < RANK_ORDER[best.rank],
      ),
    );
    assert.ok(!anyLower, "чуть младшего козыря ни у кого нет");
  });

  it("козырная карта внизу колоды совпадает с козырем", () => {
    const game = findGame(2, {}, (g) => publicState(g).trumpCard !== null);
    const st = publicState(game);
    assert.ok(st.trumpCard);
    assert.equal(st.trumpCard.suit, st.trump);
  });

  it("отклоняет недопустимое число игроков и чужую четвёрку для пар", () => {
    assert.throws(() => newGame(1, 1), /invalid player count/);
    assert.throws(() => newGame(1, 7), /invalid player count/);
    assert.throws(() => newGame(1, 3, { pairs: true }), /pairs need four/);
  });

  it("посторонний игрок не в партии", () => {
    const game = newGame(1, 2);
    const result = game.apply("ghost", { type: "take" });
    assert.equal(result.ok, false);
    expectIllegal(result, /Вы не в этой партии/);
  });

  it("в фазе атаки ход только у атакующего", () => {
    const game = findGame(4, {}, (g) => ids(4).filter((id) => g.viewFor(id).yourTurn).length === 1);
    const st = publicState(game);
    assert.ok(game.viewFor(st.attackerId).yourTurn);
    for (const id of ids(4)) {
      if (id !== st.attackerId) assert.ok(!game.viewFor(id).yourTurn, `${id} не должен ходить`);
    }
  });
});

describe("атака", () => {
  it("атакует только заявленный атакующий", () => {
    const game = findGame(3, {}, () => true);
    const st = publicState(game);
    const card = firstRegular(handOf(game, st.defenderId));
    assert.ok(card);
    expectIllegal(game.apply(st.defenderId, { type: "attack", cards: [card] }), /не ваш ход/);
  });

  it("нельзя ходить картами разных номиналов", () => {
    const game = findGame(3, {}, (g) => {
      const hand = handOf(g, publicState(g).attackerId);
      const regulars = hand.filter((card) => card.kind === "regular");
      return regulars.length >= 2 && regulars[0]!.rank !== regulars[1]!.rank;
    });
    const hand = handOf(game, publicState(game).attackerId);
    const cards = hand.filter((card) => card.kind === "regular").slice(0, 2) as RegularCard[];
    expectIllegal(game.apply(publicState(game).attackerId, { type: "attack", cards }), /одного номинала/);
  });

  it("нельзя атаковать чужой картой", () => {
    const game = findGame(3, {}, () => true);
    const st = publicState(game);
    const foreign = firstRegular(handOf(game, st.defenderId));
    assert.ok(foreign);
    expectIllegal(game.apply(st.attackerId, { type: "attack", cards: [foreign] }), /нет в руке/);
  });

  it("одиночная атака открывает отбой", () => {
    const game = newGame(3, 2);
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) ?? firstRegular(handOf(game, st.attackerId));
    assert.ok(lead);
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));

    const next = publicState(game);
    assert.equal(next.phase, "defend");
    assert.equal(next.defenderId, ids(2).find((id) => id !== st.attackerId));
    assert.equal(next.boutAttackerId, st.attackerId);
    assert.equal(next.table.length, 1);
    assert.equal(next.table[0]!.defense, null);
    assert.equal(cardKey(next.table[0]!.attack), cardKey(lead));
    assert.equal(handOf(game, st.attackerId).length, 5);
  });

  it("за двоих можно пойти джокером, за большее число — нет", () => {
    const two = findGame(2, { jokers: true }, (g) =>
      handOf(g, publicState(g).attackerId).some((card) => card.kind === "joker"),
    );
    const twoSeat = publicState(two);
    const joker = handOf(two, twoSeat.attackerId).find((card) => card.kind === "joker");
    assert.ok(joker);
    expectOk(two.apply(twoSeat.attackerId, { type: "attack", cards: [joker] }));
    assert.equal(publicState(two).table[0]!.attack.kind, "joker");

    const three = findGame(3, { jokers: true }, (g) =>
      handOf(g, publicState(g).attackerId).some((card) => card.kind === "joker"),
    );
    const threeSeat = publicState(three);
    const jokerThree = handOf(three, threeSeat.attackerId).find((card) => card.kind === "joker");
    assert.ok(jokerThree);
    expectIllegal(three.apply(threeSeat.attackerId, { type: "attack", cards: [jokerThree] }), /Джокером нельзя ходить/);
  });
});

describe("отбой и взятие", () => {
  it("не защитник не отбивается", () => {
    const game = newGame(3, 2);
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) ?? firstRegular(handOf(game, st.attackerId));
    assert.ok(lead);
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    expectIllegal(game.apply(st.attackerId, { type: "defend", card: lead, against: lead }), /не ваш ход/);
  });

  it("карта, которая не бьёт, не принимается", () => {
    const game = findGame(2, {}, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      return handOf(g, st.defenderId).some((card) => !canBeat(card, lead, st.trump));
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    const weak = handOf(game, st.defenderId).find((card) => !canBeat(card, lead, st.trump));
    assert.ok(weak);
    expectIllegal(game.apply(st.defenderId, { type: "defend", card: weak!, against: lead }), /не бьёт/);
  });

  it("against не со стола не принимается", () => {
    const game = findGame(2, {}, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      return canBeatCard(handOf(g, st.defenderId), lead, st.trump) !== undefined;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, st.defenderId), lead, st.trump);
    assert.ok(beat);
    const decoy = handOf(game, st.defenderId).find((card) => cardKey(card) !== cardKey(beat));
    assert.ok(decoy);
    expectIllegal(game.apply(st.defenderId, { type: "defend", card: beat!, against: decoy! }), /уже отбили|нет на столе/);
  });

  it("полный отбой открывает «бито» и сбрасывает стол", () => {
    const game = findGame(2, {}, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      return lead !== null && canBeatCard(handOf(g, st.defenderId), lead, st.trump) !== undefined;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const attacker = st.attackerId;
    const defender = st.defenderId;
    expectOk(game.apply(attacker, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, defender), lead, st.trump) as RegularCard;
    expectOk(game.apply(defender, { type: "defend", card: beat, against: lead }));

    let next = publicState(game);
    assert.equal(next.phase, "throw_in");
    expectOk(game.apply(attacker, { type: "done" }));

    next = publicState(game);
    assert.equal(next.phase, "attack");
    assert.deepEqual(next.table, []);
    assert.equal(next.discardCount, 2);
    assert.equal(next.attackerId, defender);
    assert.equal(game.wantsAutoClose(), false);
    for (const id of ids(2)) assert.equal(handOf(game, id).length, 6);
  });

  it("взятие возвращает карты защитнику и передаёт ход по кругу", () => {
    const game = newGame(3, 2);
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) ?? firstRegular(handOf(game, st.attackerId));
    assert.ok(lead);
    const attacker = st.attackerId;
    let defender = st.defenderId;
    const deckBefore = st.deckCount;

    expectOk(game.apply(attacker, { type: "attack", cards: [lead] }));
    expectIllegal(game.apply(attacker, { type: "take" }), /нельзя брать/);
    const handBefore = handOf(game, defender).length;
    expectOk(game.apply(defender, { type: "take" }));

    const next = publicState(game);
    assert.equal(handOf(game, defender).length, handBefore + 1);
    assert.deepEqual(next.table, []);
    assert.equal(next.discardCount, 0);
    assert.equal(next.deckCount, deckBefore - 1);
    assert.equal(next.phase, "attack");
    assert.equal(next.attackerId, attacker); // за двумя после взятия ход возвращается к тому же
    assert.ok(next.attackerId !== defender);
  });
});

describe("подкидывание", () => {
  it("защитник не подкидывает", () => {
    const game = findGame(2, {}, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      return lead !== null && canBeatCard(handOf(g, st.defenderId), lead, st.trump) !== undefined;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const card = firstRegular(handOf(game, st.defenderId)) as RegularCard;
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, st.defenderId), lead, st.trump) as RegularCard;
    expectOk(game.apply(st.defenderId, { type: "defend", card: beat, against: lead }));
    expectIllegal(game.apply(st.defenderId, { type: "throw_in", cards: [card] }), /Защитник не подкидывает/);
  });

  it("не соседу — только заходный номинал", () => {
    const game = findGame(4, {}, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      const beat = canBeatCard(handOf(g, st.defenderId), lead, st.trump);
      if (!beat || beat.kind !== "regular" || beat.rank === lead.rank) return false;
      const far = ids(4).find((id) => id !== st.attackerId && id !== st.defenderId);
      if (!far) return false;
      const farHand = handOf(g, far);
      const hasLeadRank = farHand.some((card) => card.kind === "regular" && card.rank === lead.rank);
      const hasBeatRank = farHand.some((card) => card.kind === "regular" && card.rank === beat.rank);
      return hasLeadRank && hasBeatRank;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const far = ids(4).find((id) => id !== st.attackerId && id !== st.defenderId) as string;
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, st.defenderId), lead, st.trump) as RegularCard;
    expectOk(game.apply(st.defenderId, { type: "defend", card: beat, against: lead }));

    const foreign = handOf(game, far).find((card) => card.kind === "regular" && card.rank === beat.rank) as RegularCard;
    expectIllegal(game.apply(far, { type: "throw_in", cards: [foreign] }), /заходную/);

    const share = handOf(game, far).find((card) => card.kind === "regular" && card.rank === lead.rank) as RegularCard;
    expectOk(game.apply(far, { type: "throw_in", cards: [share] }));
    assert.equal(publicState(game).phase, "defend");
    assert.equal(publicState(game).table.length, 2);
  });

  it("нельзя подкинуть чужой номинал", () => {
    const game = findGame(2, {}, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      const beat = canBeatCard(handOf(g, st.defenderId), lead, st.trump);
      if (!beat || beat.kind !== "regular") return false;
      return handOf(g, st.attackerId).some((card) => card.kind === "regular" && card.rank !== lead.rank && card.rank !== beat.rank);
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const attacker = st.attackerId;
    expectOk(game.apply(attacker, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, st.defenderId), lead, st.trump) as RegularCard;
    expectOk(game.apply(st.defenderId, { type: "defend", card: beat, against: lead }));

    const tableRanks = publicState(game).tableRanks;
    const wrong = handOf(game, attacker).find(
      (card) => card.kind === "regular" && card.rank !== lead.rank && card.rank !== beat.rank && !tableRanks.includes(card.rank),
    ) as RegularCard;
    expectIllegal(game.apply(attacker, { type: "throw_in", cards: [wrong] }), /тех номиналов/);
  });

  it("подкинутая карта возвращает фазу в отбой", () => {
    const game = findGame(2, {}, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      const beat = canBeatCard(handOf(g, st.defenderId), lead, st.trump);
      if (!beat) return false;
      return handOf(g, st.attackerId).some((card) => card.kind === "regular" && card.rank === lead.rank);
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const attacker = st.attackerId;
    expectOk(game.apply(attacker, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, st.defenderId), lead, st.trump) as RegularCard;
    expectOk(game.apply(st.defenderId, { type: "defend", card: beat, against: lead }));

    const extra = handOf(game, attacker).find((card) => card.kind === "regular" && card.rank === lead.rank) as RegularCard;
    expectOk(game.apply(attacker, { type: "throw_in", cards: [extra] }));
    assert.equal(publicState(game).phase, "defend");
    assert.equal(publicState(game).table.filter((pair) => pair.defense === null).length, 1);
  });

  it("джокер на столе закрывает ход сам", () => {
    const game = findGame(2, { jokers: true }, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      return handOf(g, st.defenderId).some((card) => card.kind === "joker");
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const attacker = st.attackerId;
    expectOk(game.apply(attacker, { type: "attack", cards: [lead] }));
    const joker = handOf(game, st.defenderId).find((card) => card.kind === "joker");
    assert.ok(joker);
    expectOk(game.apply(st.defenderId, { type: "defend", card: joker!, against: lead }));

    assert.equal(publicState(game).phase, "throw_in");
    assert.ok(game.wantsAutoClose());
    expectIllegal(game.apply(attacker, { type: "done" }), /закрывается сам/);
    expectIllegal(game.apply(attacker, { type: "throw_in", cards: [lead] }), /закрывается сам/);

    game.finishAutoClose();
    const next = publicState(game);
    assert.equal(next.phase, "attack");
    assert.deepEqual(next.table, []);
    assert.equal(next.discardCount, 2);
    assert.ok(!game.wantsAutoClose());
  });
});

describe("перевод (переводной дурак)", () => {
  const transferable = (count: number, options: GameOptions = {}) =>
    findGame(count, { mode: "perevodnoy", ...options }, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      return handOf(g, st.defenderId).some((card) => card.kind === "regular" && card.rank === lead.rank);
    });

  it("перевод передаёт защиту следующему", () => {
    const game = transferable(3);
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const attacker = st.attackerId;
    const defender = st.defenderId;
    const transfer = handOf(game, defender).find((card) => card.kind === "regular" && card.rank === lead.rank) as RegularCard;
    expectOk(game.apply(attacker, { type: "attack", cards: [lead] }));
    expectOk(game.apply(defender, { type: "transfer", card: transfer }));

    const next = publicState(game);
    assert.equal(next.phase, "defend");
    assert.equal(next.attackerId, attacker);
    assert.ok(next.defenderId !== defender);
    assert.ok(next.passedIds.includes(defender));
    assert.equal(next.table.length, 2);
    assert.ok(next.table.every((pair) => pair.defense === null));
  });

  it("переводить обратно заходному атакующему нельзя", () => {
    const game = findGame(3, { mode: "perevodnoy" }, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      const nextDefender = handOf(g, st.defenderId).some((card) => card.kind === "regular" && card.rank === lead.rank);
      const further = ids(3).find((id) => id !== st.attackerId && id !== st.defenderId);
      if (!further) return false;
      const furtherHas = handOf(g, further).some((card) => card.kind === "regular" && card.rank === lead.rank);
      return nextDefender && furtherHas;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const defender = st.defenderId;
    const further = ids(3).find((id) => id !== st.attackerId && id !== st.defenderId) as string;
    const first = handOf(game, defender).find((card) => card.kind === "regular" && card.rank === lead.rank) as RegularCard;
    const second = handOf(game, further).find((card) => card.kind === "regular" && card.rank === lead.rank) as RegularCard;
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    expectOk(game.apply(defender, { type: "transfer", card: first }));
    expectIllegal(game.apply(further, { type: "transfer", card: second }), /нельзя перевести/);
  });

  it("после отбоя переводить некуда", () => {
    const game = findGame(2, { mode: "perevodnoy" }, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      return lead !== null && canBeatCard(handOf(g, st.defenderId), lead, st.trump) !== undefined;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, st.defenderId), lead, st.trump) as RegularCard;
    expectOk(game.apply(st.defenderId, { type: "defend", card: beat, against: lead }));
    const card = firstRegular(handOf(game, st.defenderId)) as RegularCard;
    expectIllegal(game.apply(st.defenderId, { type: "transfer", card }), /нельзя переводить/);
  });

  it("в подкидном перевода нет, даже картой того же номинала", () => {
    const game = findGame(2, { mode: "podkidnoy" }, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      return handOf(g, st.defenderId).some((card) => card.kind === "regular" && card.rank === lead.rank);
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const defender = st.defenderId;
    const same = handOf(game, defender).find((card) => card.kind === "regular" && card.rank === lead.rank) as RegularCard;
    const other = handOf(game, defender).find((card) => card.kind === "regular" && card.rank !== lead.rank) as RegularCard;
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    expectIllegal(game.apply(defender, { type: "transfer", card: same }), /нельзя перевести/);
    expectIllegal(game.apply(defender, { type: "transfer", card: other }), /нельзя перевести/);
  });
});

describe("свечение (переводной дурак)", () => {
  const gameWithFlash = () => findGame(2, { mode: "perevodnoy" }, (g) => flashPair(g) !== null);

  it("козырь того же номинала светится и остаётся в руке", () => {
    const game = gameWithFlash();
    const pair = flashPair(game);
    assert.ok(pair);
    const defender = publicState(game).defenderId;
    const cardsBefore = handOf(game, defender).length;
    expectOk(game.apply(publicState(game).attackerId, { type: "attack", cards: [pair.lead] }));
    expectOk(game.apply(defender, { type: "flash", card: pair.trumper }));

    const next = publicState(game);
    assert.equal(handOf(game, defender).length, cardsBefore);
    assert.ok(next.flash);
    assert.equal(next.flash!.playerId, defender);
    assert.equal(cardKey(next.flash!.card), cardKey(pair.trumper));
    const flashed = next.players.find((player) => player.id === defender);
    assert.ok(flashed?.flashedRanks.includes(pair.lead.rank));
    assert.equal(next.phase, "defend");
  });

  it("светит только защищающийся козырем со стола", () => {
    const game = gameWithFlash();
    const st = publicState(game);
    const lead = firstRegular(handOf(game, st.attackerId)) as RegularCard;
    const defender = st.defenderId;
    expectIllegal(game.apply(st.attackerId, { type: "flash", card: lead }), /нельзя светить/);
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    const nonTrump = handOf(game, defender).find((card) => card.kind === "regular" && card.suit !== st.trump);
    if (nonTrump) {
      expectIllegal(game.apply(defender, { type: "flash", card: nonTrump }), /нельзя посветить/);
    }
    const notOnTable = handOf(game, defender).find(
      (card) => card.kind === "regular" && card.suit === st.trump && card.rank !== lead.rank,
    );
    if (notOnTable) {
      expectIllegal(game.apply(defender, { type: "flash", card: notOnTable }), /нельзя посветить/);
    }
  });

  it("в подкидном свечения нет", () => {
    const game = findGame(2, { mode: "podkidnoy" }, (g) =>
      handOf(g, publicState(g).defenderId).some((card) => card.kind === "regular" && card.suit === publicState(g).trump),
    );
    const st = publicState(game);
    const lead = firstRegular(handOf(game, st.attackerId)) as RegularCard;
    const trumper = handOf(game, st.defenderId).find(
      (card) => card.kind === "regular" && card.suit === st.trump,
    ) as RegularCard;
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    expectIllegal(game.apply(st.defenderId, { type: "flash", card: trumper }), /нельзя посветить/);
  });
});

describe("«бито»", () => {
  it("до полного отбоя «бито» не говорят", () => {
    const game = newGame(3, 2);
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) ?? firstRegular(handOf(game, st.attackerId));
    assert.ok(lead);
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    expectIllegal(game.apply(st.attackerId, { type: "done" }), /Сначала нужно отбить карты/);
  });

  it("защитник и напарник «бито» не говорят", () => {
    const game = findGame(2, {}, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      return lead !== null && canBeatCard(handOf(g, st.defenderId), lead, st.trump) !== undefined;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, st.defenderId), lead, st.trump) as RegularCard;
    expectOk(game.apply(st.defenderId, { type: "defend", card: beat, against: lead }));
    expectIllegal(game.apply(st.defenderId, { type: "done" }), /говорит не защитник/);
  });

  it("все атакующие подтверждают — стол сбрасывается", () => {
    const game = findGame(3, {}, (g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      return lead !== null && canBeatCard(handOf(g, st.defenderId), lead, st.trump) !== undefined;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const attacker = st.attackerId;
    const defender = st.defenderId;
    const third = ids(3).find((id) => id !== attacker && id !== defender) as string;
    expectOk(game.apply(attacker, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, defender), lead, st.trump) as RegularCard;
    expectOk(game.apply(defender, { type: "defend", card: beat, against: lead }));

    assert.equal(publicState(game).phase, "throw_in");
    expectOk(game.apply(attacker, { type: "done" }));
    let next = publicState(game);
    assert.equal(next.phase, "throw_in");
    assert.deepEqual(next.bitoIds, [attacker]);
    expectIllegal(game.apply(attacker, { type: "done" }), /уже сказали/);
    expectOk(game.apply(third, { type: "pass" }));
    next = publicState(game);
    assert.equal(next.phase, "attack");
    assert.deepEqual(next.table, []);
    assert.equal(next.discardCount, 2);
    assert.equal(next.attackerId, defender);
  });
});

describe("выигрыш и конец партии", () => {
  it("обычная партия доигрывается до одного в дураках", () => {
    const game = newGame(3, 2, {});
    const steps = playUntilOver(game, 2, 36);
    assert.ok(steps >= 5, "партия закончилась слишком быстро");

    const st = publicState(game);
    assert.equal(st.phase, "finished");
    assert.equal(st.loserIds.length, 1);
    assert.equal(st.durakId, st.loserIds[0]);
    const withCards = ids(2).filter((id) => handOf(game, id).length > 0);
    assert.deepEqual(withCards, st.loserIds, "в дураках остаётся единственный игрок с картами");
    expectIllegal(game.apply(st.durakId!, { type: "take" }), /Партия уже закончена/);
  });

  it("в четвёрке партия сохраняет все карты и доходит до конца", () => {
    const game = newGame(5, 4, {});
    const steps = playUntilOver(game, 4, 36);
    assert.ok(steps >= 5);
    assert.equal(publicState(game).phase, "finished");
    assert.ok(publicState(game).loserIds.length >= 1 && publicState(game).loserIds.length <= 4);
  });
});

describe("игра 2 на 2", () => {
  const pairsGame = (predicate: (game: DurakGame) => boolean = () => true) =>
    findGame(4, { pairs: true }, predicate);

  const defenderAlly = (st: ReturnType<typeof publicState>) =>
    st.players.find((player) => player.seat === ((st.players.find((p) => p.id === st.defenderId)?.seat ?? 0) + 2) % 4);

  it("напарник защитника видит свой ход", () => {
    const game = pairsGame();
    const st = publicState(game);
    expectOk(game.apply(st.attackerId, { type: "attack", cards: [firstRegular(handOf(game, st.attackerId)) as RegularCard] }));
    const ally = defenderAlly(publicState(game));
    assert.ok(ally);
    assert.ok(game.viewFor(ally.id).yourTurn);
  });

  it("напарник помогает отбиваться", () => {
    const game = pairsGame((g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      const beatable = canBeatCard(handOf(g, st.defenderId), lead, st.trump);
      const ally = defenderAlly(st);
      if (!beatable || !ally) return false;
      return canBeatCard(handOf(g, ally.id), lead, st.trump) !== undefined;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const attacker = st.attackerId;
    expectOk(game.apply(attacker, { type: "attack", cards: [lead] }));
    const ally = defenderAlly(publicState(game));
    assert.ok(ally);
    const beat = canBeatCard(handOf(game, ally.id), lead, st.trump) as RegularCard;
    expectOk(game.apply(ally.id, { type: "defend", card: beat, against: lead }));
    assert.equal(publicState(game).phase, "throw_in");
  });

  it("соперники защитника подтверждают «бито», напарник — нет", () => {
    const game = pairsGame((g) => {
      const st = publicState(g);
      const lead = lowestTrump(handOf(g, st.attackerId), st.trump);
      if (!lead) return false;
      const ally = defenderAlly(st);
      if (!ally) return false;
      return canBeatCard(handOf(g, ally.id), lead, st.trump) !== undefined;
    });
    const st = publicState(game);
    const lead = lowestTrump(handOf(game, st.attackerId), st.trump) as RegularCard;
    const attacker = st.attackerId;
    const defender = st.defenderId;
    const ally = defenderAlly(publicState(game))?.id;
    const other = ids(4).find((id) => id !== attacker && id !== defender && id !== ally) as string;
    expectOk(game.apply(attacker, { type: "attack", cards: [lead] }));
    const beat = canBeatCard(handOf(game, ally!), lead, st.trump) as RegularCard;
    expectOk(game.apply(ally!, { type: "defend", card: beat, against: lead }));

    expectIllegal(game.apply(ally!, { type: "done" }), /напарника/);
    expectOk(game.apply(attacker, { type: "done" }));
    expectOk(game.apply(other, { type: "done" }));
    const next = publicState(game);
    assert.equal(next.phase, "attack");
    assert.deepEqual(next.table, []);
    assert.equal(next.attackerId, defender);
  });
});