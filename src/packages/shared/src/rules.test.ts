import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canBeat,
  canFlash,
  canLead,
  canThrowIn,
  canTransfer,
  edgePlayerIds,
  losesWithLoneJoker,
  nextCanReceive,
  nextSeatId,
  partnerId,
  tableAttackRanks,
  throwRoom,
} from "./rules";
import type { PassContext } from "./rules";
import type { Card, JokerCard, Rank, RegularCard, Suit } from "./cards";

const c = (suit: Suit, rank: Rank): RegularCard => ({ kind: "regular", suit, rank });
const j = (color: "black" | "red"): JokerCard => ({ kind: "joker", color });

const TRUMP: Suit = "spades";

function passContext(overrides: Partial<PassContext> = {}): PassContext {
  return {
    mode: "perevodnoy",
    card: c("hearts", "7"),
    tableRanks: ["7"],
    anyBeaten: false,
    unbeatenCount: 1,
    nextHandCount: 6,
    nextCanReceive: true,
    ...overrides,
  };
}

describe("canBeat", () => {
  it("старшая карта той же масти бьёт младшую", () => {
    assert.ok(canBeat(c("hearts", "K"), c("hearts", "9"), TRUMP));
    assert.ok(!canBeat(c("hearts", "9"), c("hearts", "K"), TRUMP));
    assert.ok(!canBeat(c("hearts", "7"), c("hearts", "7"), TRUMP));
  });

  it("козырь бьёт небиткую масть, но не наоборот", () => {
    assert.ok(canBeat(c("spades", "6"), c("hearts", "A"), TRUMP));
    assert.ok(!canBeat(c("hearts", "2"), c("spades", "6"), TRUMP));
  });

  it("небиткие масти между собой не бьются", () => {
    assert.ok(!canBeat(c("diamonds", "A"), c("hearts", "6"), TRUMP));
  });

  it("козыри бьются только по старшинству", () => {
    assert.ok(canBeat(c("spades", "A"), c("spades", "K"), TRUMP));
    assert.ok(!canBeat(c("spades", "9"), c("spades", "10"), TRUMP));
  });

  it("любой джокер бьёт обычную карту, но не джокера", () => {
    assert.ok(canBeat(j("black"), c("spades", "A"), TRUMP));
    assert.ok(canBeat(j("red"), c("hearts", "2"), TRUMP));
    assert.ok(!canBeat(j("black"), j("red"), TRUMP));
    assert.ok(!canBeat(c("spades", "A"), j("black"), TRUMP));
  });
});

describe("canThrowIn", () => {
  it("подкидывается только номинал со стола", () => {
    assert.ok(canThrowIn(c("diamonds", "K"), ["7", "K"]));
    assert.ok(!canThrowIn(c("diamonds", "Q"), ["7", "K"]));
    assert.ok(!canThrowIn(c("diamonds", "K"), []));
  });

  it("джокер подкинуть нельзя", () => {
    assert.ok(!canThrowIn(j("red"), ["7"]));
  });
});

describe("throwRoom", () => {
  it("отбитые пары не занимают место в руке защитника", () => {
    assert.equal(throwRoom(6, 1), 5);
    assert.equal(throwRoom(3, 3), 0);
    assert.equal(throwRoom(1, 3), 0);
  });
});

describe("canLead", () => {
  it("обычной картой ходят при любом числе игроков", () => {
    assert.ok(canLead(c("hearts", "6"), 2));
    assert.ok(canLead(c("hearts", "6"), 5));
  });

  it("джокером ходят только за двоих", () => {
    assert.ok(canLead(j("black"), 2));
    assert.ok(!canLead(j("black"), 3));
  });
});

describe("losesWithLoneJoker", () => {
  it("один джокер в партии больше чем на двоих — проигрыш", () => {
    assert.ok(losesWithLoneJoker([j("black")], 3));
    assert.ok(!losesWithLoneJoker([j("black")], 2));
    assert.ok(!losesWithLoneJoker([j("black"), c("hearts", "6")], 3));
    assert.ok(!losesWithLoneJoker([], 3));
    assert.ok(!losesWithLoneJoker([c("hearts", "6")], 3));
  });
});

describe("tableAttackRanks", () => {
  it("номиналы атак без повторов, джокеры пропускаются", () => {
    const table: { attack: Card }[] = [{ attack: c("hearts", "7") }, { attack: c("spades", "7") }, { attack: j("red") }];
    assert.deepEqual(tableAttackRanks(table), ["7"]);
  });
});

describe("nextSeatId", () => {
  const players = [
    { id: "p2", seat: 2 },
    { id: "p0", seat: 0 },
    { id: "p1", seat: 1 },
  ];

  it("порядок по местам независимо от порядка массива, с переходом по кругу", () => {
    assert.equal(nextSeatId(players, "p0"), "p1");
    assert.equal(nextSeatId(players, "p1"), "p2");
    assert.equal(nextSeatId(players, "p2"), "p0");
  });

  it("пустая партия и неизвестный игрок дают null", () => {
    assert.equal(nextSeatId([], "p0"), null);
    assert.equal(nextSeatId(players, "p9"), null);
  });
});

describe("edgePlayerIds", () => {
  const seats = [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, seat, cardCount: 6 }));

  it("соседи защитника слева и справа", () => {
    assert.deepEqual(edgePlayerIds(seats, "p1"), ["p0", "p2"]);
    assert.deepEqual(edgePlayerIds(seats, "p0"), ["p3", "p1"]);
  });

  it("пустая рука выпадает, крайним становится следующий", () => {
    const withEmpty = seats.map((player) => (player.id === "p0" ? { ...player, cardCount: 0 } : player));
    assert.deepEqual(edgePlayerIds(withEmpty, "p1"), ["p3", "p2"]);
  });

  it("если карты остались только у одного соседа, он один и крайний", () => {
    const lonely = seats.map((player) => (player.id === "p0" ? player : { ...player, cardCount: 0 }));
    assert.deepEqual(edgePlayerIds(lonely, "p1"), ["p0"]);
  });

  it("защитника вне партии нет", () => {
    assert.deepEqual(edgePlayerIds(seats, "p9"), []);
    assert.deepEqual(edgePlayerIds([], "p1"), []);
  });
});

describe("partnerId", () => {
  const players = [0, 1, 2, 3].map((seat) => ({ id: `p${seat}`, seat }));

  it("в парах напарник сидит напротив", () => {
    assert.equal(partnerId(players, "p0"), "p2");
    assert.equal(partnerId(players, "p3"), "p1");
  });

  it("вне четвёрки напарника нет", () => {
    assert.equal(partnerId(players.slice(0, 3), "p0"), null);
    assert.equal(partnerId(players, "p9"), null);
  });
});

describe("nextCanReceive", () => {
  it("уже переводивший в этом заходе принимает не может", () => {
    assert.ok(!nextCanReceive({ nextId: "p2", passedIds: ["p2"], boutAttackerId: "p0", playerCount: 4 }));
  });

  it("перевод обратно на заходного атакующего запрещён, когда игроков больше двух", () => {
    assert.ok(!nextCanReceive({ nextId: "p0", passedIds: [], boutAttackerId: "p0", playerCount: 3 }));
    assert.ok(nextCanReceive({ nextId: "p0", passedIds: [], boutAttackerId: "p0", playerCount: 2 }));
  });

  it("обычный следующий игрок принимает перевод", () => {
    assert.ok(nextCanReceive({ nextId: "p2", passedIds: ["p1"], boutAttackerId: "p0", playerCount: 4 }));
  });
});

describe("canTransfer", () => {
  it("перевод той же картой возможен в переводном дураке", () => {
    assert.ok(canTransfer(passContext()));
  });

  it("в подкидном перевода нет", () => {
    assert.ok(!canTransfer(passContext({ mode: "podkidnoy" })));
  });

  it("после первого отбоя перевести нельзя", () => {
    assert.ok(!canTransfer(passContext({ anyBeaten: true })));
  });

  it("переводят только картой номинала со стола", () => {
    assert.ok(!canTransfer(passContext({ card: c("hearts", "8") })));
    assert.ok(!canTransfer(passContext({ card: j("red") })));
  });

  it("принимающий должен чем отбиваться: карт хватает на все атаки плюс одну", () => {
    assert.ok(canTransfer(passContext({ unbeatenCount: 2, nextHandCount: 3 })));
    assert.ok(!canTransfer(passContext({ unbeatenCount: 2, nextHandCount: 2 })));
  });

  it("нельзя перевести тому, кто уже переводил или это заходный атакующий", () => {
    assert.ok(!canTransfer(passContext({ nextCanReceive: false })));
  });
});

describe("canFlash", () => {
  const base = { trump: TRUMP, flashedRanks: [] as Rank[] };

  it("козырь того же номинала светит", () => {
    assert.ok(canFlash({ ...passContext({ card: c("spades", "7") }), ...base }));
  });

  it("в подкидном свечения нет", () => {
    assert.ok(!canFlash({ ...passContext({ mode: "podkidnoy", card: c("spades", "7") }), ...base }));
  });

  it("светить можно только козырем и только номиналом со стола", () => {
    assert.ok(!canFlash({ ...passContext({ card: c("hearts", "7") }), ...base }));
    assert.ok(!canFlash({ ...passContext({ card: c("spades", "8") }), ...base }));
    assert.ok(!canFlash({ ...passContext({ card: j("black") }), ...base }));
  });

  it("тот же номинал светится один раз", () => {
    assert.ok(!canFlash({ ...passContext({ card: c("spades", "7") }), trump: TRUMP, flashedRanks: ["7"] }));
  });

  it("принимающему хватает карт отбиться хотя бы чем-то", () => {
    assert.ok(canFlash({ ...passContext({ card: c("spades", "7"), unbeatenCount: 2, nextHandCount: 2 }), ...base }));
    assert.ok(!canFlash({ ...passContext({ card: c("spades", "7"), unbeatenCount: 2, nextHandCount: 1 }), ...base }));
  });

  it("свечение не проходит, когда нельзя переводить дальше", () => {
    assert.ok(!canFlash({ ...passContext({ card: c("spades", "7"), anyBeaten: true }), ...base }));
    assert.ok(!canFlash({ ...passContext({ card: c("spades", "7"), nextCanReceive: false }), ...base }));
  });
});
