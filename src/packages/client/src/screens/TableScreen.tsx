import {
  RANK_ORDER,
  SUITS,
  canBeat,
  canFlash,
  canLead,
  canThrowIn,
  canTransfer,
  cardKey,
  edgePlayerIds,
  nextCanReceive,
  partnerId,
  nextSeatId,
  tableAttackRanks,
  throwRoom,
  type Card,
  type GameLogKind,
  type Suit,
} from "@durka/shared";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { CardView } from "../components/CardView";
import { PHASE_LABEL, RANK_LABEL, SUIT_NAME, SUIT_SYMBOL, deckCaption, isRedSuit, modeCaption } from "../labels";
import { useGame } from "../net/GameProvider";

const LOG_MARK: Record<GameLogKind, string> = {
  deal: "Старт",
  attack: "Ход",
  defend: "Отбой",
  transfer: "Перевод",
  flash: "Свет",
  throw: "Подкид",
  take: "Беру",
  done: "Бито",
  next: "Дальше",
  end: "Итог",
};

function LogText({ text }: { text: string }) {
  return text.split(/([♥♦])/).map((part, index) =>
    part === "♥" || part === "♦" ? (
      <span key={index} className="log-red">
        {part}
      </span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

type AutoSort = "trump" | "suit" | "rank";
type TableAim = { kind: "table" } | { kind: "beat"; attackKey: string };
type HandSort = AutoSort | "custom";

type FlightCard = {
  id: string;
  card: Card;
  left: number;
  top: number;
  dx: number;
  dy: number;
  delay: number;
  spin: number;
};
const SORT_STORAGE = "durka:hand-sort";
const ORDER_STORAGE = "durka:hand-order";
const LOG_STORAGE = "durka:log";

function readLogOpen(): boolean {
  try {
    return localStorage.getItem(LOG_STORAGE) === "open";
  } catch {
    return false;
  }
}

function readHandSort(): HandSort {
  try {
    const saved = sessionStorage.getItem(SORT_STORAGE);
    if (saved === "suit" || saved === "rank" || saved === "custom") return saved;
    return "trump";
  } catch {
    return "trump";
  }
}

function readCustomOrder(): string[] {
  try {
    const raw = sessionStorage.getItem(ORDER_STORAGE);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writeCustomOrder(keys: readonly string[]): void {
  try {
    sessionStorage.setItem(ORDER_STORAGE, JSON.stringify(keys));
  } catch {
    // свой порядок останется до обновления страницы
  }
}

function arrangeCustom(hand: readonly Card[], order: readonly string[]): Card[] {
  const byKey = new Map(hand.map((card) => [cardKey(card), card]));
  const placed: Card[] = [];
  for (const key of order) {
    const card = byKey.get(key);
    if (!card) continue;
    placed.push(card);
    byKey.delete(key);
  }
  for (const card of hand) {
    if (byKey.has(cardKey(card))) placed.push(card);
  }
  return placed;
}

function reorderKeys(keys: readonly string[], fromKey: string, toIndex: number): string[] {
  const from = keys.indexOf(fromKey);
  if (from < 0) return [...keys];
  const next = keys.filter((key) => key !== fromKey);
  const insert = toIndex > from ? toIndex - 1 : toIndex;
  next.splice(Math.max(0, Math.min(insert, next.length)), 0, fromKey);
  return next;
}

function handOrder(card: Card, trump: Suit, mode: AutoSort): readonly [number, number, number, number] {
  if (card.kind === "joker") return [2, 0, card.color === "red" ? 1 : 0, 0];
  const rank = RANK_ORDER[card.rank];
  const suit = SUITS.indexOf(card.suit);
  if (mode === "trump") return [card.suit === trump ? 0 : 1, rank, suit, 0];
  if (mode === "rank") return [0, rank, suit, 0];
  return [card.suit === trump ? 1 : 0, suit, rank, 0];
}

function sortHandChoice(hand: readonly Card[], trump: Suit, mode: AutoSort): Card[] {
  return [...hand].sort((left, right) => {
    const a = handOrder(left, trump, mode);
    const b = handOrder(right, trump, mode);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
  });
}

function cardsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} карта`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} карты`;
  return `${count} карт`;
}

function isOpeningSet(cards: Card[], playerCount: number): boolean {
  if (cards.length === 0 || cards.some((card) => !canLead(card, playerCount))) return false;
  if (cards.length === 1) return true;
  const first = cards[0];
  if (!first || first.kind !== "regular") return false;
  return cards.every((card) => card.kind === "regular" && card.rank === first.rank);
}

/** Место на эллипсе: вы внизу, следующий по часовой стрелке — слева. */
function seatPoint(slot: number, total: number): { left: string; top: string } {
  const angle = Math.PI + (slot * 2 * Math.PI) / Math.max(total, 1);
  return {
    left: `${50 + Math.sin(angle) * 32}%`,
    top: `${50 - Math.cos(angle) * 30}%`,
  };
}

export function TableScreen() {
  const game = useGame();
  const view = game.view;
  const room = game.room;
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<HandSort>(readHandSort);
  const [customOrder, setCustomOrder] = useState<string[]>(readCustomOrder);
  const handStrip = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    key: string;
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
    boxes: { left: number; top: number; right: number; bottom: number }[];
    step: number;
    node: HTMLDivElement;
  } | null>(null);
  const suppressClick = useRef(false);
  const flipRef = useRef<Map<string, DOMRect> | null>(null);
  const [logOpen, setLogOpen] = useState(readLogOpen);
  const logBox = useRef<HTMLDivElement>(null);
  const feltRef = useRef<HTMLDivElement>(null);
  const pileRef = useRef<HTMLDivElement>(null);
  const discardSnap = useRef<{ count: number; table: { attack: Card; defense: Card | null }[] } | null>(null);
  const flightTimer = useRef<number | null>(null);
  const [flights, setFlights] = useState<FlightCard[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [dragStep, setDragStep] = useState(0);
  const [tableAim, setTableAim] = useState<TableAim | null>(null);
  const logLength = view?.public.log.length ?? 0;
  const handKey = view?.hand.map((card) => cardKey(card)).join("|") ?? "";
  const openKey =
    view?.public.table
      .filter((pair) => pair.defense === null)
      .map((pair) => cardKey(pair.attack))
      .join("|") ?? "";

  useEffect(() => {
    const alive = new Set(handKey ? handKey.split("|") : []);
    const open = new Set(openKey ? openKey.split("|") : []);
    setSelectedKeys((current) => {
      const next = current.filter((key) => alive.has(key));
      return next.length === current.length ? current : next;
    });
    setTargetKey((current) => (current && open.has(current) ? current : null));
  }, [handKey, openKey]);

  useEffect(() => {
    const keys = handKey ? handKey.split("|") : [];
    setCustomOrder((current) => {
      const kept = current.filter((key) => keys.includes(key));
      const added = keys.filter((key) => !kept.includes(key));
      const next = [...kept, ...added];
      if (next.length === current.length && next.every((key, index) => key === current[index])) return current;
      writeCustomOrder(next);
      return next;
    });
  }, [handKey]);

  useLayoutEffect(() => {
    const before = flipRef.current;
    const strip = handStrip.current;
    if (!before || !strip) return;
    flipRef.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = [...strip.querySelectorAll<HTMLElement>("[data-hand-card]")];
    for (const node of nodes) {
      const id = node.dataset.handCard;
      const prev = id ? before.get(id) : undefined;
      if (!prev) continue;
      const next = node.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        node.style.transition = "transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)";
        node.style.transform = "";
        const clear = () => {
          node.style.transition = "";
          node.removeEventListener("transitionend", clear);
        };
        node.addEventListener("transitionend", clear);
      });
    }
  }, [customOrder, dragKey]);

  useEffect(() => {
    const node = logBox.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [logLength]);

  useEffect(() => {
    const table = view?.public.table ?? [];
    const count = view?.public.discardCount ?? 0;
    const previous = discardSnap.current;
    discardSnap.current = { count, table };
    if (!previous || count <= previous.count || previous.table.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const pile = pileRef.current?.getBoundingClientRect();
    const felt = feltRef.current?.getBoundingClientRect();
    if (!pile || !felt) return;

    const cards: Card[] = [];
    for (const pair of previous.table) {
      cards.push(pair.attack);
      if (pair.defense) cards.push(pair.defense);
    }
    const originX = felt.left + felt.width / 2 - 31;
    const originY = felt.top + felt.height / 2 - 45;
    const targetX = pile.left + pile.width / 2 - 31;
    const targetY = pile.top + pile.height / 2 - 40;
    setFlights(
      cards.map((card, index) => {
        const left = originX + ((index % 4) - 1.5) * 22;
        const top = originY + Math.floor(index / 4) * 14;
        return {
          id: `${count}-${cardKey(card)}-${index}`,
          card,
          left,
          top,
          dx: targetX - left,
          dy: targetY - top,
          delay: index * 28,
          spin: (index % 5 - 2) * 6,
        };
      }),
    );
    if (flightTimer.current) window.clearTimeout(flightTimer.current);
    flightTimer.current = window.setTimeout(() => setFlights([]), 700 + cards.length * 28);
  }, [view]);

  useEffect(() => {
    return () => {
      if (flightTimer.current) window.clearTimeout(flightTimer.current);
    };
  }, []);

  if (!view || !room) return null;

  const field = view.public;
  const trumpRed = isRedSuit(field.trump);
  const around = [...field.players].sort((left, right) => left.seat - right.seat);
  const youIndex = Math.max(0, around.findIndex((player) => player.id === view.youId));
  const clockwise = around.map((_, slot) => around[(youIndex + slot) % around.length] ?? around[0]).filter((player) => player !== undefined);
  const hand = sortMode === "custom" ? arrangeCustom(view.hand, customOrder) : sortHandChoice(view.hand, field.trump, sortMode);
  const selectedCards = hand.filter((card) => selectedKeys.includes(cardKey(card)));
  const selected = selectedCards.length === 1 ? selectedCards[0] : null;
  const unbeaten = field.table.filter((pair) => pair.defense === null);
  const target =
    unbeaten.find((pair) => cardKey(pair.attack) === targetKey)?.attack ??
    (unbeaten.length === 1 ? unbeaten[0]?.attack : undefined);
  const me = field.players.find((player) => player.id === view.youId);
  const nextId = nextSeatId(field.players, field.defenderId);
  const next = field.players.find((player) => player.id === nextId);
  const attackRanks = tableAttackRanks(field.table);
  const passContext = selected
    ? {
        mode: field.mode,
        card: selected,
        tableRanks: attackRanks,
        anyBeaten: field.table.some((pair) => pair.defense !== null),
        unbeatenCount: unbeaten.length,
        nextHandCount: next?.cardCount ?? 0,
        nextCanReceive: nextId
          ? nextCanReceive({
              nextId,
              passedIds: field.passedIds,
              boutAttackerId: field.boutAttackerId,
              playerCount: field.players.length,
            })
          : false,
      }
    : null;
  const flashingPlayer = field.players.find((player) => player.id === field.flash?.playerId);
  const defenderCount = field.players.find((player) => player.id === field.defenderId)?.cardCount ?? 0;
  const canAttack =
    view.yourTurn &&
    field.phase === "attack" &&
    isOpeningSet(selectedCards, field.players.length) &&
    selectedCards.length <= defenderCount;
  const youId = view.youId;
  const youDefend = field.defenderId === youId;
  const youHelp = field.pairs && partnerId(field.players, field.defenderId) === youId;
  const youCover = (youDefend || youHelp) && field.phase === "defend";
  const myPartnerId = field.pairs ? partnerId(field.players, youId) : null;
  const canDefend = youCover && selected !== null && target !== undefined && canBeat(selected, target, field.trump);
  const canPass = youCover && passContext !== null && canTransfer(passContext);
  const canShow =
    youCover &&
    passContext !== null &&
    canFlash({ ...passContext, trump: field.trump, flashedRanks: me?.flashedRanks ?? [] });
  const edges = edgePlayerIds(field.players, field.defenderId);
  const youEdge = edges.includes(youId);
  const saidBito = field.bitoIds.includes(youId);
  const tableJoker = field.table.some((pair) => pair.attack.kind === "joker" || pair.defense?.kind === "joker");
  const leadCard = field.table[0]?.attack;
  const leadRank = leadCard?.kind === "regular" ? leadCard.rank : null;
  const roomLeft = throwRoom(defenderCount, unbeaten.length);
  const canThrow =
    !youDefend &&
    !tableJoker &&
    (field.phase === "defend" || field.phase === "throw_in") &&
    selectedCards.length > 0 &&
    selectedCards.every(
      (card) => canThrowIn(card, field.tableRanks) && ((youEdge && !youHelp) || (card.kind === "regular" && card.rank === leadRank)),
    ) &&
    selectedCards.length <= roomLeft;
  const allBeaten = field.table.length > 0 && field.table.every((pair) => pair.defense);
  const autoFinish = allBeaten && (tableJoker || defenderCount === 0);
  const youMustBito = !youDefend && !youHelp && (me?.cardCount ?? 0) > 0;
  const canClose = field.phase === "throw_in" && youMustBito && !saidBito && !autoFinish;
  const attacker = field.players.find((player) => player.id === field.attackerId);
  const defender = field.players.find((player) => player.id === field.defenderId);
  const youAttack = field.attackerId === youId;
  const yourTurn = view.yourTurn;
  const sameSeat = field.attackerId === field.defenderId;

  function who(id: string, name: string | undefined): string {
    if (id === youId) return "Вы";
    return name ?? "Игрок";
  }

  function seatTag(id: string): string {
    if (field.phase === "finished") return "вне игры";
    if (id === field.attackerId && id === field.defenderId) return "отбивается";
    if (id === field.attackerId) return "атакует";
    if (id === field.defenderId) return "отбивается";
    return "ждёт";
  }

  function jokerLocked(card: Card): boolean {
    if (card.kind !== "joker") return false;
    if (youCover) return false;
    return !(field.phase === "attack" && yourTurn && canLead(card, field.players.length));
  }

  function toggleCard(key: string) {
    setSelectedKeys((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      const card = hand.find((item) => cardKey(item) === key);
      if (!card || jokerLocked(card)) return current;
      const chosen = hand.filter((item) => current.includes(cardKey(item)));
      if (card.kind === "joker") {
        if (chosen.length > 0) return current;
        return [key];
      }
      if (field.phase === "attack") {
        const next = [...chosen, card];
        if (!isOpeningSet(next, field.players.length)) return chosen.some((item) => item.kind === "joker") ? current : [key];
        if (next.length > defenderCount) return current;
        return [...current, key];
      }
      if ((field.phase === "defend" || field.phase === "throw_in") && !youDefend) {
        const leadThrow = card.kind === "regular" && card.rank === leadRank;
        if (youHelp) {
          if (field.phase === "defend" && !leadThrow) return [key];
          if (!leadThrow || tableJoker || !canThrowIn(card, field.tableRanks)) return current;
          if (chosen.length + 1 > roomLeft) return current;
          const chosenAreLead = chosen.every((item) => item.kind === "regular" && item.rank === leadRank);
          if (!chosenAreLead) return [key];
          return [...current, key];
        }
        if (tableJoker) return current;
        if (!canThrowIn(card, field.tableRanks)) return current;
        if (!youEdge && (card.kind !== "regular" || card.rank !== leadRank)) return current;
        if (chosen.length + 1 > roomLeft) return current;
        return [...current, key];
      }
      return [key];
    });
  }

  function playAttack() {
    if (!canAttack) return;
    game.play({ type: "attack", cards: selectedCards });
  }

  function playDefend(card: Card, against: Card) {
    game.play({ type: "defend", card, against });
  }

  function onHandCard(key: string) {
    const card = hand.find((item) => cardKey(item) === key);
    if (youCover && card && !cardCanTransfer(card)) {
      const aimed = unbeaten.find((pair) => cardKey(pair.attack) === targetKey);
      if (aimed && canBeat(card, aimed.attack, field.trump)) {
        playDefend(card, aimed.attack);
        return;
      }
      const matches = unbeaten.filter((pair) => canBeat(card, pair.attack, field.trump));
      if (!aimed && matches.length === 1 && matches[0]) {
        playDefend(card, matches[0].attack);
        return;
      }
    }
    toggleCard(key);
  }

  function toggleLog() {
    setLogOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(LOG_STORAGE, next ? "open" : "hidden");
      } catch {
        // журнал останется в этом положении до обновления страницы
      }
      return next;
    });
  }

  function indexInBoxes(x: number, y: number, boxes: { left: number; top: number; right: number; bottom: number }[]): number {
    let onRow = false;
    let after = boxes.length;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (!box || y < box.top - 8 || y > box.bottom + 8) continue;
      onRow = true;
      if (x < box.left + (box.right - box.left) / 2) return index;
      after = index + 1;
    }
    if (onRow) return after;
    let nearest = boxes.length;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (!box) continue;
      const midX = box.left + (box.right - box.left) / 2;
      const midY = box.top + (box.bottom - box.top) / 2;
      const dx = x - midX;
      const dy = y - midY;
      const dist = dx * dx + dy * dy;
      if (dist < best) {
        best = dist;
        nearest = dx < 0 ? index : index + 1;
      }
    }
    return nearest;
  }

  function canThrowCard(card: Card): boolean {
    if (youDefend || tableJoker || roomLeft < 1) return false;
    if (field.phase !== "defend" && field.phase !== "throw_in") return false;
    if (!canThrowIn(card, field.tableRanks)) return false;
    if (youHelp || !youEdge) return card.kind === "regular" && card.rank === leadRank;
    return true;
  }

  function aimAt(x: number, y: number, card: Card): { over: boolean; aim: TableAim | null } {
    const felt = feltRef.current?.getBoundingClientRect();
    if (!felt || x < felt.left || x > felt.right || y < felt.top || y > felt.bottom) return { over: false, aim: null };
    const nodes = feltRef.current?.querySelectorAll<HTMLElement>("[data-drop-attack]") ?? [];
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      const attackKey = node.dataset.dropAttack;
      if (!attackKey || x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      const attack = unbeaten.find((pair) => cardKey(pair.attack) === attackKey)?.attack;
      if (attack && youCover && canBeat(card, attack, field.trump)) return { over: true, aim: { kind: "beat", attackKey } };
      return { over: true, aim: null };
    }
    if (field.phase === "attack" && yourTurn && isOpeningSet([card], field.players.length) && defenderCount >= 1) {
      return { over: true, aim: { kind: "table" } };
    }
    if (youCover && cardCanTransfer(card)) return { over: true, aim: { kind: "table" } };
    if (canThrowCard(card)) return { over: true, aim: { kind: "table" } };
    const beatable = youCover ? unbeaten.filter((pair) => canBeat(card, pair.attack, field.trump)) : [];
    if (beatable.length === 1 && beatable[0]) return { over: true, aim: { kind: "beat", attackKey: cardKey(beatable[0].attack) } };
    return { over: true, aim: null };
  }

  function commitDrop(card: Card, aim: TableAim): void {
    if (aim.kind === "beat") {
      const attack = unbeaten.find((pair) => cardKey(pair.attack) === aim.attackKey)?.attack;
      if (attack && youCover && canBeat(card, attack, field.trump)) playDefend(card, attack);
      return;
    }
    if (field.phase === "attack" && yourTurn) {
      const key = cardKey(card);
      const bunch =
        selectedKeys.includes(key) &&
        selectedCards.length > 1 &&
        isOpeningSet(selectedCards, field.players.length) &&
        selectedCards.length <= defenderCount
          ? selectedCards
          : [card];
      if (isOpeningSet(bunch, field.players.length) && bunch.length <= defenderCount) game.play({ type: "attack", cards: bunch });
      return;
    }
    if (youCover && cardCanTransfer(card)) {
      game.play({ type: "transfer", card });
      return;
    }
    if (canThrowCard(card)) game.play({ type: "throw_in", cards: [card] });
  }

  function onSlotDown(event: ReactPointerEvent<HTMLDivElement>, key: string) {
    if (event.button !== 0) return;
    suppressClick.current = false;
    dragRef.current = {
      key,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      boxes: [],
      step: 0,
      node: event.currentTarget,
    };
  }

  function onSlotMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
    if (!drag.moved) {
      drag.node.setPointerCapture(event.pointerId);
      const nodes = [...(handStrip.current?.querySelectorAll<HTMLElement>("[data-hand-card]") ?? [])];
      drag.boxes = nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      });
      const first = drag.boxes[0];
      const second = drag.boxes[1];
      drag.step = first && second ? second.left - first.left : first ? first.right - first.left : 0;
      drag.moved = true;
      setDragStep(drag.step);
    }
    const card = hand.find((item) => cardKey(item) === drag.key);
    const hit = card ? aimAt(event.clientX, event.clientY, card) : { over: false, aim: null };
    setDragKey(drag.key);
    setDragOffset({ x: event.clientX - drag.x, y: event.clientY - drag.y });
    setTableAim(hit.aim);
    setDropIndex(hit.over ? null : indexInBoxes(event.clientX, event.clientY, drag.boxes));
  }

  function onSlotUp(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    dragRef.current = null;
    const moved = drag.moved;
    const card = hand.find((item) => cardKey(item) === drag.key);
    const hit = moved && card ? aimAt(event.clientX, event.clientY, card) : { over: false, aim: null };
    if (moved && commit && hit.over) {
      suppressClick.current = true;
      if (hit.aim && card) commitDrop(card, hit.aim);
      const active = document.activeElement;
      if (active instanceof HTMLElement && event.currentTarget.contains(active)) active.blur();
    } else if (moved && commit && handStrip.current) {
      const before = new Map<string, DOMRect>();
      for (const node of handStrip.current.querySelectorAll<HTMLElement>("[data-hand-card]")) {
        const id = node.dataset.handCard;
        if (id) before.set(id, node.getBoundingClientRect());
      }
      flipRef.current = before;
      suppressClick.current = true;
      const next = reorderKeys(hand.map((card) => cardKey(card)), drag.key, indexInBoxes(event.clientX, event.clientY, drag.boxes));
      setCustomOrder(next);
      writeCustomOrder(next);
      if (sortMode !== "custom") chooseSort("custom");
      const active = document.activeElement;
      if (active instanceof HTMLElement && event.currentTarget.contains(active)) active.blur();
    }
    setDragKey(null);
    setDropIndex(null);
    setDragOffset(null);
    setDragStep(0);
    setTableAim(null);
  }

  function chooseSort(mode: HandSort) {
    setSortMode(mode);
    try {
      sessionStorage.setItem(SORT_STORAGE, mode);
    } catch {
      // порядок карт останется до обновления страницы
    }
  }

  function pendingBito(): string {
    const names = field.players
      .filter((player) => {
        const ally = field.pairs ? partnerId(field.players, field.defenderId) : null;
        return player.id !== field.defenderId && player.id !== ally && player.cardCount > 0 && !field.bitoIds.includes(player.id);
      })
      .map((player) => (player.id === youId ? "вас" : player.name));
    return names.length > 0 ? `Ждём «бито» от ${names.join(", ")}.` : "Ждём «бито».";
  }

  function cardCanTransfer(card: Card): boolean {
    if (!youCover || field.mode !== "perevodnoy" || card.kind !== "regular") return false;
    return canTransfer({
      mode: field.mode,
      card,
      tableRanks: attackRanks,
      anyBeaten: field.table.some((pair) => pair.defense !== null),
      unbeatenCount: unbeaten.length,
      nextHandCount: next?.cardCount ?? 0,
      nextCanReceive: nextId
        ? nextCanReceive({
            nextId,
            passedIds: field.passedIds,
            boutAttackerId: field.boutAttackerId,
            playerCount: field.players.length,
          })
        : false,
    });
  }

  function cardPlayable(card: Card): boolean | null {
    if (field.phase === "attack" && yourTurn) {
      return card.kind === "joker" ? canLead(card, field.players.length) : true;
    }
    if (youCover && unbeaten.length > 0) {
      const options = target ? [target] : unbeaten.map((pair) => pair.attack);
      const beats = options.some((against) => canBeat(card, against, field.trump)) || cardCanTransfer(card);
      const leadThrow =
        !tableJoker && roomLeft > 0 && card.kind === "regular" && card.rank === leadRank && canThrowIn(card, field.tableRanks);
      if (beats) return true;
      if (!leadThrow) return false;
      if (selectedKeys.includes(cardKey(card))) return true;
      return selectedKeys.length < roomLeft;
    }
    if (
      youHelp &&
      !tableJoker &&
      (field.phase === "defend" || field.phase === "throw_in") &&
      roomLeft > 0 &&
      leadRank !== null
    ) {
      const allowed = card.kind === "regular" && card.rank === leadRank && canThrowIn(card, field.tableRanks);
      if (!allowed) return false;
      if (selectedKeys.includes(cardKey(card))) return true;
      return selectedKeys.length < roomLeft;
    }
    if (
      !youDefend &&
      !youHelp &&
      !tableJoker &&
      (field.phase === "defend" || field.phase === "throw_in") &&
      roomLeft > 0 &&
      (youEdge || leadRank !== null)
    ) {
      const allowed = canThrowIn(card, field.tableRanks) && (youEdge || (card.kind === "regular" && card.rank === leadRank));
      if (!allowed) return false;
      if (selectedKeys.includes(cardKey(card))) return true;
      return selectedKeys.length < roomLeft;
    }
    return null;
  }

  function loserNames(): string[] {
    return field.players
      .filter((player) => field.loserIds.includes(player.id))
      .map((player) => (player.id === youId ? "Вы" : player.name));
  }

  function finishHint(): string {
    const names = loserNames();
    if (names.length === 0) return "Ничья.";
    if (names.length === 1) return field.loserIds[0] === youId ? "Вы остались в дураках." : `${names[0]} остался в дураках.`;
    if (field.loserIds.includes(youId)) return "Ваша пара осталась в дураках.";
    return `${names.join(" и ")} остались в дураках.`;
  }

  function finishTitle(): string {
    const names = loserNames();
    if (names.length === 0) return "Ничья";
    if (names.length === 1) return field.loserIds[0] === youId ? "Вы в дураках" : `${names[0]} в дураках`;
    if (field.loserIds.includes(youId)) return "Ваша пара в дураках";
    return `${names.join(" и ")} в дураках`;
  }

  function hintText(): string {
    if (field.phase === "finished") return finishHint();
    if (autoFinish) {
      return defenderCount === 0 ? "Защитник сбросил все карты. Ход закроется сам." : "Джокер на столе. Карты сбросятся сами.";
    }
    if (field.phase === "throw_in") {
      if (youHelp) {
        return !tableJoker && roomLeft > 0 && leadRank !== null
          ? "Можно подкинуть заходную карту. «Бито» говорят соперники."
          : "Вы с напарником защищаетесь. «Бито» говорят соперники.";
      }
      if (youDefend) return pendingBito();
      if (!youMustBito) return "Вы уже без карт. «Бито» говорить не нужно.";
      if (!saidBito && roomLeft > 0 && (youEdge || leadRank !== null)) {
        return youEdge
          ? "Подсвечены карты, которые можно подкинуть. «Бито» говорят те, у кого ещё есть карты."
          : "Можно подкинуть заходную карту. «Бито» говорят те, у кого ещё есть карты.";
      }
      if (saidBito && roomLeft > 0 && (youEdge || leadRank !== null)) {
        return youEdge
          ? "Можно подкинуть ещё. Прежнее «бито» при этом сбросится."
          : "Можно подкинуть заходную карту. Прежнее «бито» при этом сбросится.";
      }
      if (!saidBito) return "Скажите «бито». Нужен ответ каждого, у кого есть карты.";
      return `Вы сказали «бито». ${pendingBito()}`;
    }
    if (youHelp && field.phase === "defend") {
      const beat = unbeaten.length > 1 ? "Выберите карту на столе, затем бейте своей." : "Нажмите свою карту — она побьёт стол за напарника.";
      const pass = field.mode === "perevodnoy" ? " Можно перевести или посветить за него." : "";
      const lead = !tableJoker && roomLeft > 0 && leadRank !== null ? " Заходную карту можно подкинуть." : "";
      return `Карты напарника не видны.${pass}${lead} ${beat}`;
    }
    if (field.phase === "defend" && !youDefend) {
      if (tableJoker) return "После джокера подкидывать нельзя.";
      if (roomLeft <= 0) return "Больше подкинуть нельзя: у защитника не хватит карт.";
      if (youEdge) return "Подсвечены карты, которые можно подкинуть.";
      if (leadRank !== null) return "Можно подкинуть только заходную карту.";
      return "Подкидывают только соседи защитника.";
    }
    if (youDefend && field.phase === "defend") {
      const beat = unbeaten.length > 1 ? "Выберите карту на столе, затем нажмите, чем бить." : "Нажмите карту в руке — она сразу побьёт стол.";
      return hand.some((card) => cardCanTransfer(card)) ? `Можно перевести картой того же номинала. ${beat}` : beat;
    }
    if (yourTurn && field.phase === "attack") return "Можно отметить несколько карт одного номинала.";
    if (yourTurn) return "Выберите карту в руке.";
    return "Ждём ход соперника.";
  }

  return (
    <main className="table-screen">
      <aside className="panel rail">
        <div className="rail-top">
          <p className="eyebrow">стол {room.code}</p>
          <h2>{PHASE_LABEL[field.phase]}</h2>
          <div className="rail-pills">
            <span className="pill">{modeCaption(field.mode)}{field.pairs ? " · 2 на 2" : ""}</span>
            <span className="pill">{deckCaption(room.deckSize, room.jokers)}</span>
          </div>
        </div>
        <div className={`trump-stack ${trumpRed ? "trump-red" : ""}`}>
          <span className="eyebrow">Козырь · {SUIT_NAME[field.trump]}</span>
          {field.trumpCard ? <CardView card={field.trumpCard} /> : <span className="trump-mark">{SUIT_SYMBOL[field.trump]}</span>}
          <span className="rail-deck">В колоде {field.deckCount}</span>
        </div>
        <div className="rail-actions">
          {!logOpen && (
            <button type="button" className="ghost" onClick={toggleLog}>
              Журнал
            </button>
          )}
          <button type="button" className="ghost" onClick={game.leaveRoom}>
            Выйти
          </button>
        </div>
      </aside>

      <section className="table-ring" aria-label="Рассадка за круглым столом">
        <div className="ring-oval" />
        {clockwise.map((player, slot) => {
          if (!player) return null;
          const point = seatPoint(slot, clockwise.length);
          const yours = player.id === youId;
          return (
            <article
              key={player.id}
              className={[
                "ring-seat",
                player.connected ? "" : "offline",
                yours ? "ring-you" : "",
                player.id === myPartnerId ? "ring-ally" : "",
                player.id === field.attackerId ? "seat-attack" : "",
                player.id === field.defenderId ? "seat-defend" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={point}
            >
              <span className="ring-who">
                <span className="avatar ring-avatar" aria-hidden="true">
                  {(yours ? "В" : player.name).slice(0, 1).toUpperCase()}
                </span>
                <strong>{yours ? "Вы" : player.name}</strong>
              </span>
              <span className="pill">{seatTag(player.id)}</span>
              {player.id === myPartnerId && <span className="pill">напарник</span>}
              <span className="ring-count">{cardsLabel(player.cardCount)}</span>
              {player.flashedRanks.length > 0 && (
                <span className="ring-flash">светил {player.flashedRanks.map((rank) => RANK_LABEL[rank]).join(", ")}</span>
              )}
              {field.phase === "throw_in" && field.bitoIds.includes(player.id) && <span className="ring-flash">бито</span>}
            </article>
          );
        })}
        <div className={tableAim?.kind === "table" ? "felt ring-center drop-ready" : "felt ring-center"} ref={feltRef}>
          {field.phase !== "finished" && attacker && defender && (
            <p className="ring-caption">
              <span className="pill">
                {sameSeat
                  ? `${who(defender.id, defender.name)} отбивается`
                  : `${who(attacker.id, attacker.name)} → ${who(defender.id, defender.name)}`}
              </span>
            </p>
          )}
          {field.flash && (
            <div className="flash-note">
              <CardView card={field.flash.card} />
              <p>{flashingPlayer?.name ?? "Игрок"} светит козырь. Карта остаётся в руке.</p>
            </div>
          )}
          <div className="felt-board">
            <div className="felt-main">
              {field.table.length === 0 ? (
                <p className="empty">Стол пуст.</p>
              ) : (
                <div className="pairs">
                  {field.table.map((pair) => (
                    <div
                      key={cardKey(pair.attack)}
                      className={
                        tableAim?.kind === "beat" && tableAim.attackKey === cardKey(pair.attack) ? "pair drop-ready" : "pair"
                      }
                      data-drop-attack={pair.defense ? undefined : cardKey(pair.attack)}
                    >
                      <CardView
                        card={pair.attack}
                        playable={
                          youDefend && !pair.defense && selected ? canBeat(selected, pair.attack, field.trump) : undefined
                        }
                        selected={cardKey(pair.attack) === targetKey}
                        onClick={
                          pair.defense
                            ? undefined
                            : () => {
                                if (youDefend && selected && canBeat(selected, pair.attack, field.trump)) {
                                  playDefend(selected, pair.attack);
                                  return;
                                }
                                setTargetKey(cardKey(pair.attack));
                              }
                        }
                      />
                      {pair.defense ? <CardView card={pair.defense} /> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className={flights.length > 0 ? "discard-pile landed" : "discard-pile"} ref={pileRef}>
              <div className="discard-stack" aria-hidden="true">
                {field.discardCount > 0 ? (
                  <>
                    <span className="discard-back back-a" />
                    <span className="discard-back back-b" />
                    <span className="discard-back back-c" />
                  </>
                ) : (
                  <span className="discard-slot" />
                )}
              </div>
              <span className="discard-label">Отбой{field.discardCount > 0 ? ` ${field.discardCount}` : ""}</span>
            </div>
          </div>
        </div>
        {flights.map((flight) => (
          <div
            key={flight.id}
            className="flight-card"
            style={{
              left: flight.left,
              top: flight.top,
              animationDelay: `${flight.delay}ms`,
              ["--dx" as string]: `${flight.dx}px`,
              ["--dy" as string]: `${flight.dy}px`,
              ["--spin" as string]: `${flight.spin}deg`,
            }}
          >
            <CardView card={flight.card} />
          </div>
        ))}
      </section>
      {logOpen && (
      <aside className="panel play-log" aria-label="Журнал партии">
        <div className="log-head">
          <h2>Журнал</h2>
          <button type="button" className="ghost" onClick={toggleLog}>
            Скрыть
          </button>
        </div>
        {field.log[0] && (
          <p className={`log-line log-${field.log[0].kind}`}>
            <span className="log-mark">{LOG_MARK[field.log[0].kind]}</span>
            <span>
              <LogText text={field.log[0].text} />
            </span>
          </p>
        )}
        <div className="log-scroll" ref={logBox}>
          {field.log.slice(1).map((entry) => (
            <p key={entry.id} className={`log-line log-${entry.kind}`}>
              <span className="log-mark">{LOG_MARK[entry.kind]}</span>
              <span>
                <LogText text={entry.text} />
              </span>
            </p>
          ))}
        </div>
      </aside>
      )}

      <section className={["panel", "hand-wrap", youAttack ? "you-attack" : "", youDefend || youCover ? "you-defend" : ""].filter(Boolean).join(" ")}>
        <div className="hand-head">
          <h2>
            Ваши карты
            {field.phase !== "finished" && youAttack && !youDefend && !youHelp && defender ? ` · вы ходите, ${defender.name} отбивается` : ""}
            {field.phase !== "finished" && youDefend && attacker
              ? youAttack
                ? " · вы отбиваетесь"
                : ` · ${attacker.name} ходит на вас`
              : ""}
            {youCover && !youDefend && defender ? ` · помогаете ${defender.name}` : ""}
            {youHelp && !tableJoker && roomLeft > 0 && leadRank !== null ? " · можно подкинуть заходную" : ""}
            {(field.phase === "defend" || field.phase === "throw_in") &&
            !youDefend &&
            !youHelp &&
            !tableJoker &&
            roomLeft > 0 &&
            (youEdge || leadRank !== null)
              ? " · можно подкинуть"
              : ""}
          </h2>
          <div className="sort-switch" role="group" aria-label="Порядок карт">
            <button type="button" className={sortMode === "trump" ? "on" : ""} title="Сначала козыри, затем по старшинству" onClick={() => chooseSort("trump")}>
              Козыри
            </button>
            <button type="button" className={sortMode === "suit" ? "on" : ""} title="Карты одной масти вместе" onClick={() => chooseSort("suit")}>
              Масти
            </button>
            <button type="button" className={sortMode === "rank" ? "on" : ""} title="От младших к старшим, без группировки" onClick={() => chooseSort("rank")}>
              Возрастание
            </button>
            <button type="button" className={sortMode === "custom" ? "on" : ""} title="Перетащите карты в нужном порядке" onClick={() => chooseSort("custom")}>
              Свой
            </button>
          </div>
        </div>
        {me && me.flashedRanks.length > 0 && (
          <p className="hint">Светил: {me.flashedRanks.map((rank) => RANK_LABEL[rank]).join(", ")}</p>
        )}
        {sortMode === "custom" && <p className="hint">Влево или вправо — порядок в руке. На стол — ход этой картой.</p>}
        <div className={["hand", sortMode === "custom" ? "hand-custom" : "", dragKey ? "hand-dragging" : ""].filter(Boolean).join(" ")} ref={handStrip}>
          {hand.map((card, index) => {
            const key = cardKey(card);
            const live = cardPlayable(card);
            const locked = jokerLocked(card) || (live === false && !youCover);
            const fromIndex = dragKey ? hand.findIndex((item) => cardKey(item) === dragKey) : -1;
            let slide = 0;
            if (dragKey && dragKey !== key && dropIndex !== null && dragStep !== 0 && fromIndex >= 0) {
              if (dropIndex > fromIndex && index > fromIndex && index < dropIndex) slide = -dragStep;
              if (dropIndex < fromIndex && index >= dropIndex && index < fromIndex) slide = dragStep;
            }
            const lifted = dragKey === key && dragOffset;
            const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const slotStyle: CSSProperties | undefined = lifted
              ? {
                  transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(1.06) rotate(-3deg)`,
                  zIndex: 8,
                  transition: "none",
                }
              : dragKey
                ? {
                    transform: slide ? `translateX(${slide}px)` : undefined,
                    transition: motion ? "none" : "transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)",
                  }
                : undefined;
            return (
              <div
                key={key}
                className={dragKey === key ? "hand-slot is-dragging" : "hand-slot"}
                data-hand-card={key}
                style={slotStyle}
                onPointerDown={(event) => onSlotDown(event, key)}
                onPointerMove={onSlotMove}
                onPointerUp={(event) => onSlotUp(event, true)}
                onPointerCancel={(event) => onSlotUp(event, false)}
              >
                <CardView
                  card={card}
                  trump={card.kind === "regular" && card.suit === field.trump}
                  playable={live === null ? undefined : live}
                  selected={selectedKeys.includes(key)}
                  onClick={
                    locked
                      ? undefined
                      : () => {
                          if (suppressClick.current) {
                            suppressClick.current = false;
                            return;
                          }
                          onHandCard(key);
                        }
                  }
                />
              </div>
            );
          })}
        </div>
        <div className="actions">
          <button type="button" disabled={!canAttack} onClick={playAttack}>
            Атаковать{selectedCards.length > 1 && field.phase === "attack" ? ` ${selectedCards.length}` : ""}
          </button>
          <button type="button" disabled={!canDefend} onClick={() => selected && target && playDefend(selected, target)}>
            {youHelp ? "Помочь" : "Отбиться"}
          </button>
          {field.mode === "perevodnoy" && (
            <>
              <button type="button" disabled={!canPass} onClick={() => selected && game.play({ type: "transfer", card: selected })}>
                Перевести
              </button>
              <button type="button" disabled={!canShow} onClick={() => selected && game.play({ type: "flash", card: selected })}>
                Посветить
              </button>
            </>
          )}
          <button
            type="button"
            disabled={!(youDefend && field.phase === "defend" && field.table.length > 0)}
            onClick={() => game.play({ type: "take" })}
          >
            Беру
          </button>
          <button
            type="button"
            disabled={!canThrow}
            onClick={() => canThrow && game.play({ type: "throw_in", cards: selectedCards.filter((card) => card.kind !== "joker") })}
          >
            Подкинуть{selectedCards.length > 1 && (field.phase === "defend" || field.phase === "throw_in") ? ` ${selectedCards.length}` : ""}
          </button>
          <button type="button" disabled={!canClose} onClick={() => game.play({ type: "done" })}>
            Бито
          </button>
        </div>
        <p className="hint">{hintText()}</p>
      </section>
      {field.phase === "finished" && (
        <div className="end-screen">
          <div className="end-card">
            <p className="eyebrow">Конец партии</p>
            <h2>{finishTitle()}</h2>
            <ul className="end-list">
              {field.players.map((player) => (
                <li key={player.id}>
                  <span>{player.id === youId ? "Вы" : player.name}</span>
                  <span>{field.loserIds.includes(player.id) ? "дурак" : "вышел"}</span>
                </li>
              ))}
            </ul>
            <div className="end-actions">
              <button type="button" onClick={game.returnToTable}>
                В лобби
              </button>
              <button type="button" className="ghost" onClick={game.leaveRoom}>
                На главный экран
              </button>
            </div>
            <p className="hint">В лобби стол сохраняется: можно сразу раздать следующую партию.</p>
          </div>
        </div>
      )}
    </main>
  );
}
