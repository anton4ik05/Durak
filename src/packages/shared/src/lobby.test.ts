import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clampMaxPlayers, normalizeName, normalizeRoomCode, startBlockReason } from "./lobby";
import type { RoomPlayerSnapshot, RoomSnapshot } from "./views";

function player(id: string, overrides: Partial<RoomPlayerSnapshot> = {}): RoomPlayerSnapshot {
  return { id, name: `Игрок ${id}`, seat: 0, ready: true, connected: true, ...overrides };
}

function room(overrides: Partial<RoomSnapshot> = {}, players?: RoomPlayerSnapshot[]): RoomSnapshot {
  return {
    code: "ABCD",
    hostId: "p0",
    maxPlayers: 6,
    deckSize: 36,
    jokers: false,
    mode: "podkidnoy",
    pairs: false,
    status: "lobby",
    players: players ?? [player("p0"), player("p1")],
    ...overrides,
  };
}

describe("normalizeName", () => {
  it("обрезает пробелы и схлопывает повторные", () => {
    assert.equal(normalizeName("  Антон   Петров "), "Антон Петров");
  });

  it("пустое имя отклоняется", () => {
    assert.equal(normalizeName(""), null);
    assert.equal(normalizeName("   "), null);
  });

  it("длина ограничена 16 символами", () => {
    assert.equal(normalizeName("a".repeat(16)), "a".repeat(16));
    assert.equal(normalizeName("a".repeat(17)), null);
  });
});

describe("normalizeRoomCode", () => {
  it("приводит к верхнему регистру", () => {
    assert.equal(normalizeRoomCode(" ab12 "), "AB12");
  });

  it("код — ровно четыре буквы или цифры", () => {
    assert.equal(normalizeRoomCode("ABC"), null);
    assert.equal(normalizeRoomCode("ABCDE"), null);
    assert.equal(normalizeRoomCode("AB-1"), null);
  });
});

describe("clampMaxPlayers", () => {
  it("без значения — максимум, иначе в границах 2..6", () => {
    assert.equal(clampMaxPlayers(undefined), 6);
    assert.equal(clampMaxPlayers(1), 2);
    assert.equal(clampMaxPlayers(9), 6);
    assert.equal(clampMaxPlayers(4), 4);
  });
});

describe("startBlockReason", () => {
  it("обычная партия из двух готовых стартует", () => {
    assert.equal(startBlockReason(room(), "p0"), null);
  });

  it("хост не обязан жать «Готов»", () => {
    const roomWithHostUnready = room({}, [player("p0", { ready: false }), player("p1")]);
    assert.equal(startBlockReason(roomWithHostUnready, "p0"), null);
  });

  it("идущую игру не начинают заново", () => {
    assert.match(startBlockReason(room({ status: "playing" }), "p0") ?? "", /уже идёт/);
  });

  it("начинает только создатель стола", () => {
    assert.match(startBlockReason(room(), "p1") ?? "", /Только создатель/);
  });

  it("нужно минимум двое онлайн", () => {
    const oneOnline = room({}, [player("p0"), player("p1", { connected: false })]);
    assert.match(startBlockReason(oneOnline, "p0") ?? "", /минимум два/);
  });

  it("все гости должны нажать «Готов»", () => {
    const waiting = room({}, [player("p0"), player("p1", { ready: false })]);
    assert.match(startBlockReason(waiting, "p0") ?? "", /Готов/);
  });

  it("в 2 на 2 нужны ровно четверо онлайн", () => {
    const three = room({ pairs: true }, [player("p0"), player("p1"), player("p2")]);
    assert.match(startBlockReason(three, "p0") ?? "", /четверо/);
    const four = room({ pairs: true }, [player("p0"), player("p1"), player("p2"), player("p3")]);
    assert.equal(startBlockReason(four, "p0"), null);
  });
});
