import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cardKey,
  cardLabel,
  cardListLabel,
  createDeck,
  isCard,
  isRegularCard,
  settleTrump,
  shuffle,
  sortHand,
} from "./cards";
import type { JokerCard, JokerColor, Rank, RegularCard, Suit } from "./cards";
import { deckLength, isDeckSize, isGameMode } from "./constants";

const c = (suit: Suit, rank: Rank): RegularCard => ({ kind: "regular", suit, rank });
const j = (color: JokerColor): JokerCard => ({ kind: "joker", color });

describe("createDeck", () => {
  it("колода 36 без джокеров: по 9 карт каждой масти", () => {
    const deck = createDeck({ size: 36, jokers: false });
    assert.equal(deck.length, 36);
    assert.equal(new Set(deck.map(cardKey)).size, 36);
    assert.ok(deck.every((card) => card.kind === "regular"));
    assert.ok(!deck.some((card) => card.kind === "regular" && (card.rank === "2" || card.rank === "5")));
  });

  it("колода 52 с джокерами: 54 карты, два джокера, младшие ранги на месте", () => {
    const deck = createDeck({ size: 52, jokers: true });
    assert.equal(deck.length, 54);
    assert.equal(new Set(deck.map(cardKey)).size, 54);
    assert.ok(deck.some((card) => cardKey(card) === "spades:2"));
    assert.ok(deck.some((card) => cardKey(card) === "joker:black"));
    assert.ok(deck.some((card) => cardKey(card) === "joker:red"));
  });
});

describe("settleTrump", () => {
  it("нижняя обычная карта задаёт козырь и остаётся на месте", () => {
    const deck = [c("hearts", "6"), c("spades", "K")];
    assert.equal(settleTrump(deck), "hearts");
    assert.deepEqual(deck, [c("hearts", "6"), c("spades", "K")]);
  });

  it("если снизу джокеры, обычная карта встаёт вниз", () => {
    const deck = [j("red"), j("black"), c("diamonds", "7")];
    assert.equal(settleTrump(deck), "diamonds");
    assert.deepEqual(deck, [c("diamonds", "7"), j("red"), j("black")]);
  });

  it("без обычных карт козыря не бывает", () => {
    assert.throws(() => settleTrump([j("black"), j("red")]), /no trump/);
  });
});

describe("shuffle", () => {
  it("сохраняет состав и не меняет исходный массив", () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffle(source);
    assert.notEqual(shuffled, source);
    assert.deepEqual([...shuffled].sort(), source);
    assert.deepEqual(source, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("детерминирована при фиксированном генераторе", () => {
    // random() === 0 всегда меняет местами с нулевой позицией
    assert.deepEqual(shuffle([1, 2, 3, 4], () => 0), [2, 3, 4, 1]);
    // random() близок к 1 — каждый элемент меняется сам с собой
    assert.deepEqual(shuffle([1, 2, 3, 4], () => 0.999999), [1, 2, 3, 4]);
  });
});

describe("sortHand", () => {
  it("номиналы рядом, козырь в конце группы, джокеры справа", () => {
    const hand = [j("red"), c("clubs", "K"), c("spades", "6"), j("black"), c("hearts", "6"), c("diamonds", "7"), c("spades", "7")];
    const expected = [c("hearts", "6"), c("spades", "6"), c("diamonds", "7"), c("spades", "7"), c("clubs", "K"), j("black"), j("red")];
    assert.deepEqual(sortHand(hand, "spades"), expected);
  });

  it("не мутирует входной массив", () => {
    const hand = [c("hearts", "K"), c("hearts", "6")];
    sortHand(hand, "spades");
    assert.deepEqual(hand, [c("hearts", "K"), c("hearts", "6")]);
  });
});

describe("подписи карт", () => {
  it("cardKey различает масти и цвета джокеров", () => {
    assert.equal(cardKey(c("spades", "6")), "spades:6");
    assert.equal(cardKey(j("red")), "joker:red");
    assert.notEqual(cardKey(c("hearts", "6")), cardKey(c("spades", "6")));
  });

  it("cardLabel рисует карту русскими буквами", () => {
    assert.equal(cardLabel(c("spades", "6")), "6♠");
    assert.equal(cardLabel(c("clubs", "10")), "10♣");
    assert.equal(cardLabel(c("hearts", "J")), "В♥");
    assert.equal(cardLabel(c("hearts", "Q")), "Д♥");
    assert.equal(cardLabel(c("hearts", "K")), "К♥");
    assert.equal(cardLabel(c("hearts", "A")), "Т♥");
    assert.equal(cardLabel(j("black")), "чёрный джокер");
    assert.equal(cardLabel(j("red")), "красный джокер");
  });

  it("cardListLabel соединяет список через «и»", () => {
    assert.equal(cardListLabel([]), "");
    assert.equal(cardListLabel([c("spades", "6")]), "6♠");
    assert.equal(cardListLabel([c("spades", "6"), c("hearts", "A")]), "6♠ и Т♥");
    assert.equal(cardListLabel([c("spades", "6"), c("hearts", "A"), c("clubs", "K")]), "6♠, Т♥ и К♣");
  });
});

describe("проверки формата карт", () => {
  it("isCard принимает только настоящие карты", () => {
    assert.ok(isCard(c("spades", "6")));
    assert.ok(isCard(j("red")));
    assert.ok(!isCard(null));
    assert.ok(!isCard({}));
    assert.ok(!isCard({ kind: "regular", suit: "spades", rank: "1" }));
    assert.ok(!isCard({ kind: "joker", color: "green" }));
  });

  it("isRegularCard отвергает джокера", () => {
    assert.ok(isRegularCard(c("diamonds", "9")));
    assert.ok(!isRegularCard(j("black")));
  });
});

describe("константы колоды", () => {
  it("deckLength добавляет двух джокеров", () => {
    assert.equal(deckLength(36, false), 36);
    assert.equal(deckLength(52, true), 54);
  });

  it("допустимые размеры колоды и режимы", () => {
    assert.ok(isDeckSize(36));
    assert.ok(isDeckSize(52));
    assert.ok(!isDeckSize(24));
    assert.ok(!isDeckSize("36"));
    assert.ok(isGameMode("podkidnoy"));
    assert.ok(isGameMode("perevodnoy"));
    assert.ok(!isGameMode("chuklo"));
  });
});
