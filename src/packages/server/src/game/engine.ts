import {
  HAND_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RANK_ORDER,
  canBeat,
  canFlash,
  canLead,
  canThrowIn,
  canTransfer,
  edgePlayerIds,
  partnerId,
  losesWithLoneJoker,
  cardKey,
  cardLabel,
  cardListLabel,
  createDeck,
  deckLength,
  nextCanReceive,
  settleTrump,
  shuffle,
  sortHand,
  tableAttackRanks,
  throwRoom,
} from "@durka/shared";
import type {
  Card,
  DeckOptions,
  GameAction,
  GameMode,
  GameLogEntry,
  GamePhase,
  PlayerGameView,
  PublicGameState,
  Rank,
  RegularCard,
  Suit,
  TablePair,
} from "@durka/shared";

export type ApplyResult =
  | { ok: true }
  | { ok: false; code: "not_in_game" | "not_implemented" | "illegal_move"; message: string };

interface GameSeat {
  id: string;
  name: string;
  connected: boolean;
}

function illegal(message: string): ApplyResult {
  return { ok: false, code: "illegal_move", message };
}

/**
 * Авторитетная партия. Клиенту уходит только PlayerGameView.
 * Атака, отбой, перевод, свечение, подкидывание, «бито» и добор применяются здесь.
 */
export class DurakGame {
  private readonly hands = new Map<string, Card[]>();
  private readonly deck: Card[];
  private readonly trump: Suit;
  private readonly deckTotal: number;
  private readonly mode: GameMode;
  private readonly pairs: boolean;
  private readonly table: TablePair[] = [];
  private discardCount = 0;
  private readonly flashedRanks = new Map<string, Set<Rank>>();
  private readonly passedIds = new Set<string>();
  private readonly bitoIds = new Set<string>();
  private autoClose = false;
  private phase: GamePhase = "attack";
  private attackerIndex: number;
  private defenderIndex: number;
  private boutAttackerIndex: number;
  private durakId: string | null = null;
  private loserIds: string[] = [];
  private reveal: { playerId: string; card: RegularCard } | null = null;
  private openingTrump: RegularCard | null = null;
  private readonly events: GameLogEntry[] = [];
  private nextLogId = 1;

  constructor(
    private readonly players: GameSeat[],
    options: DeckOptions & { mode: GameMode; pairs?: boolean },
  ) {
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      throw new Error("invalid player count");
    }
    if (options.pairs && players.length !== 4) {
      throw new Error("pairs need four players");
    }

    this.mode = options.mode;
    this.pairs = options.pairs === true;
    const deck = shuffle(createDeck(options));
    this.trump = settleTrump(deck);
    this.deckTotal = deckLength(options.size, options.jokers);

    for (const player of players) {
      this.hands.set(player.id, []);
      this.flashedRanks.set(player.id, new Set());
    }

    for (let round = 0; round < HAND_SIZE; round += 1) {
      for (const player of players) {
        const card = deck.pop();
        const hand = this.hands.get(player.id);
        if (!card || !hand) throw new Error("cannot deal");
        hand.push(card);
      }
    }

    for (const [id, hand] of this.hands) {
      this.hands.set(id, sortHand(hand, this.trump));
    }

    this.deck = deck;
    const dealt = [...this.hands.values()].reduce((sum, hand) => sum + hand.length, 0);
    if (dealt + this.deck.length !== this.deckTotal) {
      throw new Error("deck invariant broken");
    }

    this.attackerIndex = this.findFirstAttacker();
    this.defenderIndex = this.nextIndex(this.attackerIndex);
    this.boutAttackerIndex = this.attackerIndex;
    const opener = this.players[this.attackerIndex];
    if (opener) {
      const trump = this.openingTrump;
      this.note(
        "deal",
        trump
          ? `Первым ходит ${opener.name}: младший козырь ${cardLabel(trump)}`
          : `Первым ходит ${opener.name}`,
      );
    }
  }

  setConnected(playerId: string, connected: boolean): void {
    const player = this.players.find((seat) => seat.id === playerId);
    if (player) player.connected = connected;
  }

  viewFor(playerId: string): PlayerGameView {
    const hand = this.hands.get(playerId);
    if (!hand) throw new Error(`unknown player ${playerId}`);
    const state = this.toPublic();
    const defenderCards = state.players.find((player) => player.id === state.defenderId)?.cardCount ?? 0;
    const edges = this.edgeIds();
    const unbeaten = state.table.filter((pair) => pair.defense === null).length;
    const roomLeft = throwRoom(defenderCards, unbeaten);
    const lead = this.openingRank();
    const holdsLead = lead !== null && hand.some((card) => card.kind === "regular" && card.rank === lead);
    const ally = this.allyId();
    const allyLead =
      playerId === ally &&
      holdsLead &&
      (state.phase === "defend" || state.phase === "throw_in") &&
      roomLeft > 0 &&
      state.table.length > 0 &&
      !this.tableHasJoker() &&
      !this.autoClose;
    const yourTurn =
      (state.phase === "attack" && state.attackerId === playerId) ||
      (state.phase === "defend" && (state.defenderId === playerId || playerId === ally)) ||
      allyLead ||
      ((state.phase === "defend" || state.phase === "throw_in") &&
        state.defenderId !== playerId &&
        playerId !== ally &&
        roomLeft > 0 &&
        state.table.length > 0 &&
        !this.tableHasJoker() &&
        !this.autoClose &&
        (edges.includes(playerId) || holdsLead)) ||
      (state.phase === "throw_in" && this.bitoVoters().includes(playerId) && !this.bitoIds.has(playerId) && !this.autoClose);

    return {
      youId: playerId,
      hand: sortHand(hand, this.trump),
      yourTurn,
      public: state,
    };
  }

  apply(playerId: string, action: GameAction): ApplyResult {
    if (!this.hands.has(playerId)) {
      return { ok: false, code: "not_in_game", message: "Вы не в этой партии" };
    }
    if (this.phase === "finished") return illegal("Партия уже закончена");

    switch (action.type) {
      case "attack":
        return this.attack(playerId, action.cards);
      case "defend":
        return this.defend(playerId, action.card, action.against);
      case "transfer":
        return this.transfer(playerId, action.card);
      case "flash":
        return this.flash(playerId, action.card);
      case "take":
        return this.take(playerId);
      case "throw_in":
        return this.throwIn(playerId, action.cards);
      case "pass":
        return this.pass(playerId);
      case "done":
        return this.done(playerId);
      default: {
        const unknown: never = action;
        return unknown;
      }
    }
  }

  private attack(playerId: string, cards: Card[]): ApplyResult {
    if (this.phase !== "attack" || this.idAt(this.attackerIndex) !== playerId) {
      return illegal("Сейчас не ваш ход");
    }
    if (this.table.length > 0) return illegal("На столе уже есть карты");
    if (!this.isOpeningAttack(cards)) {
      return illegal("Атаковать можно картами одного номинала");
    }
    const defenderHand = this.hands.get(this.idAt(this.defenderIndex))?.length ?? 0;
    if (cards.length > defenderHand) {
      return illegal("Нельзя пойти большим числом карт, чем у защитника");
    }
    if (cards.some((card) => !canLead(card, this.players.length))) {
      return illegal("Джокером нельзя ходить, если игроков больше двух");
    }
    if (!this.ownsAll(playerId, cards)) return illegal("Этой карты нет в руке");

    for (const card of cards) {
      this.takeCard(playerId, card);
      this.table.push({ attack: card, defense: null });
    }
    this.phase = "defend";
    this.boutAttackerIndex = this.attackerIndex;
    this.passedIds.clear();
    this.reveal = null;
    this.sortPlayer(playerId);
    this.note("attack", `${this.nameOf(playerId)} ходит ${cardListLabel(cards)} → ${this.nameAt(this.defenderIndex)}`);
    return { ok: true };
  }

  private defend(playerId: string, card: Card, against: Card): ApplyResult {
    if (this.phase !== "defend" || !this.covers(playerId)) {
      return illegal("Сейчас не ваш ход");
    }
    const pair = this.table.find((item) => item.defense === null && cardKey(item.attack) === cardKey(against));
    if (!pair) return illegal("Эту карту уже отбили или её нет на столе");
    if (!canBeat(card, pair.attack, this.trump)) return illegal("Эта карта не бьёт");
    if (!this.takeCard(playerId, card)) return illegal("Этой карты нет в руке");

    pair.defense = card;
    this.reveal = null;
    this.sortPlayer(playerId);
    this.note("defend", `${this.nameOf(playerId)} бьёт ${cardLabel(against)} картой ${cardLabel(card)}`);
    if (this.table.every((item) => item.defense)) this.openThrowIn();
    return { ok: true };
  }

  private transfer(playerId: string, card: Card): ApplyResult {
    const context = this.passContext(playerId, card);
    if (!context) return illegal("Сейчас нельзя переводить");
    if (!canTransfer(context)) return illegal("Этой картой нельзя перевести");
    if (!this.takeCard(playerId, card)) return illegal("Этой карты нет в руке");

    this.reveal = null;
    this.table.push({ attack: card, defense: null });
    this.finishPass(playerId);
    this.sortPlayer(playerId);
    this.note("transfer", `${this.nameOf(playerId)} переводит ${cardLabel(card)} → ${this.nameAt(this.defenderIndex)}`);
    return { ok: true };
  }

  private flash(playerId: string, card: Card): ApplyResult {
    const context = this.passContext(playerId, card);
    if (!context) return illegal("Сейчас нельзя светить");
    const flashed = [...(this.flashedRanks.get(playerId) ?? [])];
    if (!canFlash({ ...context, trump: this.trump, flashedRanks: flashed })) {
      return illegal("Этим козырем нельзя посветить");
    }
    if (card.kind !== "regular") return illegal("Светить можно только козырем");
    if (!this.owns(playerId, card)) return illegal("Этой карты нет в руке");

    this.flashedRanks.get(playerId)?.add(card.rank);
    this.reveal = { playerId, card };
    this.finishPass(playerId);
    this.note("flash", `${this.nameOf(playerId)} светит козырь ${cardLabel(card)} → ${this.nameAt(this.defenderIndex)}`);
    return { ok: true };
  }

  private take(playerId: string): ApplyResult {
    if (this.phase !== "defend" || this.idAt(this.defenderIndex) !== playerId) {
      return illegal("Сейчас нельзя брать");
    }
    if (this.table.length === 0) return illegal("На столе пусто");

    const hand = this.hands.get(playerId);
    if (!hand) return illegal("Вы не в этой партии");
    for (const pair of this.table) {
      hand.push(pair.attack);
      if (pair.defense) hand.push(pair.defense);
    }
    this.table.length = 0;
    this.reveal = null;
    this.passedIds.clear();
    this.bitoIds.clear();
    this.autoClose = false;
    this.sortPlayer(playerId);
    this.note("take", `${this.nameOf(playerId)} берёт карты`);
    const taker = this.defenderIndex;
    this.drawUp(this.attackerIndex, taker);
    if (this.finishIfOver()) return { ok: true };
    this.continueAfterBout(this.nextIndex(taker));
    return { ok: true };
  }

  private throwIn(playerId: string, cards: Card[]): ApplyResult {
    if (this.autoClose) return illegal("Ход уже закрывается сам");
    if (this.phase !== "defend" && this.phase !== "throw_in") return illegal("Сейчас нельзя подкидывать");
    if (playerId === this.idAt(this.defenderIndex)) return illegal("Защитник не подкидывает");
    const lead = this.openingRank();
    const ally = playerId === this.allyId();
    const edge = this.edgeIds().includes(playerId) && !ally;
    if (!edge && (!lead || cards.some((card) => card.kind !== "regular" || card.rank !== lead))) {
      return illegal(ally ? "Напарник может подкинуть только заходную карту" : "Не соседу можно подкинуть только заходную карту");
    }
    if (this.tableHasJoker()) return illegal("После джокера подкидывать нельзя");
    if (cards.some((card) => card.kind === "joker")) return illegal("Джокер подкинуть нельзя");
    if (!this.isThrow(cards)) return illegal("Подкинуть можно карты тех номиналов, что уже на столе");
    const defenderHand = this.hands.get(this.idAt(this.defenderIndex))?.length ?? 0;
    const unbeaten = this.table.filter((pair) => pair.defense === null).length;
    if (cards.length > throwRoom(defenderHand, unbeaten)) {
      return illegal("Нельзя подкинуть больше карт, чем у защитника");
    }
    if (!this.ownsAll(playerId, cards)) return illegal("Этой карты нет в руке");

    for (const card of cards) {
      this.takeCard(playerId, card);
      this.table.push({ attack: card, defense: null });
    }
    this.reveal = null;
    this.bitoIds.clear();
    this.sortPlayer(playerId);
    this.phase = "defend";
    this.note("throw", `${this.nameOf(playerId)} подкидывает ${cardListLabel(cards)}`);
    return { ok: true };
  }

  private pass(playerId: string): ApplyResult {
    return this.done(playerId);
  }

  private done(playerId: string): ApplyResult {
    if (this.autoClose) return illegal("Ход уже закрывается сам");
    if (this.phase !== "throw_in") return illegal("Сначала нужно отбить карты");
    const defenderId = this.idAt(this.defenderIndex);
    if (playerId === defenderId) return illegal("«Бито» говорит не защитник");
    if (playerId === this.allyId()) return illegal("«Бито» за напарника не говорят");
    const voters = this.bitoVoters();
    if (!voters.includes(playerId)) return illegal("Вы уже без карт, «бито» говорить не нужно");
    if (this.bitoIds.has(playerId)) return illegal("Вы уже сказали «бито»");
    this.bitoIds.add(playerId);
    this.note("done", `${this.nameOf(playerId)} говорит «бито»`);
    if (voters.every((id) => this.bitoIds.has(id))) this.endBout();
    return { ok: true };
  }

  /** «Бито» говорят атакующие, у кого ещё есть карты. В парах напарник не подтверждает. */
  private bitoVoters(): string[] {
    const defenderId = this.idAt(this.defenderIndex);
    const ally = this.allyId();
    return this.players
      .filter((player) => player.id !== defenderId && player.id !== ally && (this.hands.get(player.id)?.length ?? 0) > 0)
      .map((player) => player.id);
  }

  /** Напарник защитника в игре 2 на 2. Ему не отдаётся чужая рука. */
  private allyId(): string | null {
    if (!this.pairs) return null;
    return partnerId(
      this.players.map((player, seat) => ({ id: player.id, seat })),
      this.idAt(this.defenderIndex),
    );
  }

  private covers(playerId: string): boolean {
    return playerId === this.idAt(this.defenderIndex) || playerId === this.allyId();
  }

  /** Все карты отбиты. Подкидывают соседи защитника, а «бито» подтверждают все остальные. */
  private openThrowIn(): void {
    if (this.table.length === 0) {
      this.endBout();
      return;
    }
    this.bitoIds.clear();
    this.phase = "throw_in";
    const defenderId = this.idAt(this.defenderIndex);
    const defenderHand = this.hands.get(defenderId)?.length ?? 0;
    if (this.tableHasJoker() || defenderHand === 0 || this.bitoVoters().length === 0) {
      this.autoClose = true;
      const text =
        defenderHand === 0
          ? `${this.nameOf(defenderId)} сбросил все карты — ход закрывается`
          : this.tableHasJoker()
            ? "Джокер на столе — карты сбрасываются"
            : "Подтверждать некому — ход закрывается";
      this.note("done", text);
      return;
    }
    this.autoClose = false;
  }

  wantsAutoClose(): boolean {
    return this.autoClose;
  }

  /** Стол с джокером уже отбит: подтверждение не спрашиваем, карты уходят в сброс. */
  finishAutoClose(): void {
    if (!this.autoClose || this.phase === "finished") return;
    this.autoClose = false;
    this.endBout();
  }

  private openingRank(): Rank | null {
    const first = this.table[0]?.attack;
    return first?.kind === "regular" ? first.rank : null;
  }

  private edgeIds(): string[] {
    return edgePlayerIds(
      this.players.map((player, seat) => ({
        id: player.id,
        seat,
        cardCount: this.hands.get(player.id)?.length ?? 0,
      })),
      this.idAt(this.defenderIndex),
    );
  }

  private endBout(): void {
    for (const pair of this.table) {
      this.discardCount += 1;
      if (pair.defense) this.discardCount += 1;
    }
    this.table.length = 0;
    this.reveal = null;
    this.passedIds.clear();
    this.bitoIds.clear();
    this.autoClose = false;
    const defender = this.defenderIndex;
    this.drawUp(this.attackerIndex, defender);
    if (this.finishIfOver()) return;
    this.continueAfterBout(defender);
  }

  /** Атакующий добирает первым, защитник — последним. Лишние карты не сбрасываются. */
  private drawUp(first: number, last: number): void {
    const order: number[] = [];
    let index = first;
    for (let step = 0; step < this.players.length; step += 1) {
      if (index !== last) order.push(index);
      index = this.nextIndex(index);
    }
    order.push(last);
    for (const seat of order) {
      const id = this.idAt(seat);
      const hand = this.hands.get(id);
      if (!hand) continue;
      while (hand.length < HAND_SIZE && this.deck.length > 0) {
        const card = this.deck.pop();
        if (!card) break;
        hand.push(card);
      }
      this.sortPlayer(id);
    }
  }

  private finishIfOver(): boolean {
    if (this.deck.length > 0) return false;
    const team = this.losingTeam();
    if (team) {
      this.endGame(team, `${this.teamNames(team)} остались в дураках`);
      return true;
    }
    const alive = this.players.filter((player) => (this.hands.get(player.id)?.length ?? 0) > 0);
    if (alive.length > 1) return false;
    const loser = alive[0]?.id;
    this.endGame(loser ? [loser] : [], loser ? `${this.nameOf(loser)} остался в дураках` : "Ничья");
    return true;
  }

  /** Пара, у которой ещё есть карты, когда оба соперника уже пустые. */
  private losingTeam(): string[] | null {
    if (!this.pairs || this.players.length !== 4) return null;
    const teams = [
      [0, 2].map((seat) => this.idAt(seat)),
      [1, 3].map((seat) => this.idAt(seat)),
    ];
    const empty = (ids: string[]) => ids.every((id) => (this.hands.get(id)?.length ?? 0) === 0);
    const firstEmpty = empty(teams[0] ?? []);
    const secondEmpty = empty(teams[1] ?? []);
    if (firstEmpty === secondEmpty) return null;
    return firstEmpty ? (teams[1] ?? null) : (teams[0] ?? null);
  }

  private teamNames(ids: readonly string[]): string {
    return ids.map((id) => this.nameOf(id)).join(" и ");
  }

  private endGame(losers: string[], text: string): void {
    this.phase = "finished";
    this.loserIds = losers;
    this.durakId = losers[0] ?? null;
    this.note("end", text);
  }

  /** Следующий заход начинает игрок на месте `start`, пропуская пустые руки. */
  private continueAfterBout(start: number): void {
    this.attackerIndex = this.firstWithCards(start);
    this.defenderIndex = this.firstWithCards(this.nextIndex(this.attackerIndex));
    this.boutAttackerIndex = this.attackerIndex;
    if (this.defenderIndex === this.attackerIndex) {
      const team = this.losingTeam();
      const alone = this.idAt(this.attackerIndex);
      if (team) this.endGame(team, `${this.teamNames(team)} остались в дураках`);
      else this.endGame([alone], `${this.nameOf(alone)} остался в дураках`);
      return;
    }
    this.phase = "attack";
    if (this.noteLoneJoker()) return;
    this.note("next", `Следующим ходит ${this.nameAt(this.attackerIndex)}`);
  }

  private noteLoneJoker(): boolean {
    const hand = this.hands.get(this.idAt(this.attackerIndex)) ?? [];
    if (!losesWithLoneJoker(hand, this.players.length)) return false;
    const alone = this.idAt(this.attackerIndex);
    this.endGame([alone], `${this.nameOf(alone)} остался с одним джокером и проиграл`);
    return true;
  }

  private note(kind: GameLogEntry["kind"], text: string): void {
    this.events.push({ id: this.nextLogId, kind, text });
    this.nextLogId += 1;
  }

  private nameOf(playerId: string): string {
    return this.players.find((player) => player.id === playerId)?.name ?? "Игрок";
  }

  private nameAt(index: number): string {
    return this.players[index]?.name ?? "Игрок";
  }

  private firstWithCards(start: number): number {
    for (let step = 0; step < this.players.length; step += 1) {
      const index = (start + step) % this.players.length;
      if ((this.hands.get(this.idAt(index))?.length ?? 0) > 0) return index;
    }
    return start;
  }

  private isThrow(cards: Card[]): boolean {
    if (cards.length === 0) return false;
    const keys = new Set(cards.map((card) => cardKey(card)));
    if (keys.size !== cards.length) return false;
    const ranks = this.collectTableRanks();
    return cards.every((card) => canThrowIn(card, ranks));
  }

  private passContext(playerId: string, card: Card) {
    if (this.phase !== "defend" || !this.covers(playerId)) return null;
    const next = this.players[this.nextIndex(this.defenderIndex)];
    if (!next) return null;
    const unbeatenCount = this.table.filter((pair) => pair.defense === null).length;
    return {
      mode: this.mode,
      card,
      tableRanks: tableAttackRanks(this.table),
      anyBeaten: this.table.some((pair) => pair.defense !== null),
      unbeatenCount,
      nextHandCount: this.hands.get(next.id)?.length ?? 0,
      nextCanReceive: nextCanReceive({
        nextId: next.id,
        passedIds: [...this.passedIds],
        boutAttackerId: this.idAt(this.boutAttackerIndex),
        playerCount: this.players.length,
      }),
    };
  }

  private finishPass(playerId: string): void {
    this.passedIds.add(this.idAt(this.defenderIndex));
    this.passedIds.add(playerId);
    this.defenderIndex = this.nextIndex(this.defenderIndex);
  }

  private isOpeningAttack(cards: Card[]): boolean {
    if (cards.length === 0) return false;
    const keys = new Set(cards.map((card) => cardKey(card)));
    if (keys.size !== cards.length) return false;
    if (cards.length === 1 && cards[0]?.kind === "joker") return true;
    const first = cards[0];
    if (!first || first.kind !== "regular") return false;
    return cards.every((card) => card.kind === "regular" && card.rank === first.rank);
  }

  private owns(playerId: string, card: Card): boolean {
    return (this.hands.get(playerId) ?? []).some((item) => cardKey(item) === cardKey(card));
  }

  private ownsAll(playerId: string, cards: readonly Card[]): boolean {
    const hand = this.hands.get(playerId) ?? [];
    const keys = new Set(hand.map((card) => cardKey(card)));
    return cards.every((card) => keys.has(cardKey(card)));
  }

  private takeCard(playerId: string, card: Card): boolean {
    const hand = this.hands.get(playerId);
    if (!hand) return false;
    const index = hand.findIndex((item) => cardKey(item) === cardKey(card));
    if (index < 0) return false;
    hand.splice(index, 1);
    return true;
  }

  private sortPlayer(playerId: string): void {
    const hand = this.hands.get(playerId);
    if (hand) this.hands.set(playerId, sortHand(hand, this.trump));
  }

  private nextIndex(index: number): number {
    return (index + 1) % this.players.length;
  }

  private idAt(index: number): string {
    const player = this.players[index];
    if (!player) throw new Error("missing seat");
    return player.id;
  }

  private findFirstAttacker(): number {
    let bestIndex = 0;
    let bestRank = Number.POSITIVE_INFINITY;

    this.players.forEach((player, index) => {
      for (const card of this.hands.get(player.id) ?? []) {
        if (card.kind !== "regular" || card.suit !== this.trump) continue;
        const rank = RANK_ORDER[card.rank];
        if (rank < bestRank) {
          bestRank = rank;
          bestIndex = index;
          this.openingTrump = card;
        }
      }
    });

    return bestIndex;
  }

  private tableHasJoker(): boolean {
    return this.table.some((pair) => pair.attack.kind === "joker" || pair.defense?.kind === "joker");
  }

  private collectTableRanks(): Rank[] {
    const ranks = new Set<Rank>();
    for (const pair of this.table) {
      if (pair.attack.kind === "regular") ranks.add(pair.attack.rank);
      if (pair.defense?.kind === "regular") ranks.add(pair.defense.rank);
    }
    return [...ranks];
  }

  private visibleTrump(): RegularCard | null {
    const bottom = this.deck[0];
    if (!bottom || bottom.kind !== "regular") return null;
    return bottom;
  }

  private toPublic(): PublicGameState {
    const attacker = this.players[this.attackerIndex];
    const defender = this.players[this.defenderIndex];
    const boutAttacker = this.players[this.boutAttackerIndex];
    if (!attacker || !defender || !boutAttacker) throw new Error("missing seats");

    return {
      phase: this.phase,
      mode: this.mode,
      pairs: this.pairs,
      trump: this.trump,
      trumpCard: this.visibleTrump(),
      deckCount: this.deck.length,
      discardCount: this.discardCount,
      attackerId: attacker.id,
      defenderId: defender.id,
      boutAttackerId: boutAttacker.id,
      passedIds: [...this.passedIds],
      bitoIds: [...this.bitoIds],
      flash: this.reveal,
      table: this.table.map((pair) => ({ attack: pair.attack, defense: pair.defense })),
      tableRanks: this.collectTableRanks(),
      durakId: this.durakId,
      loserIds: this.loserIds,
      players: this.players.map((player, seat) => ({
        id: player.id,
        name: player.name,
        seat,
        connected: player.connected,
        cardCount: this.hands.get(player.id)?.length ?? 0,
        role:
          this.phase !== "attack" && seat === this.defenderIndex
            ? "defender"
            : seat === this.attackerIndex && this.phase !== "finished"
              ? "attacker"
              : "idle",
        flashedRanks: [...(this.flashedRanks.get(player.id) ?? [])],
      })),
      log: this.events.map((entry) => ({ ...entry })),
    };
  }
}
