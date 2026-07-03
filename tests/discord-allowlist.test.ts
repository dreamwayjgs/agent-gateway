process.env.TELEGRAM_BOT_TOKEN ??= "1:test-token";
process.env.DB_FILE = ":memory:";

import { beforeEach, expect, test } from "bun:test";
import { getDb } from "../src/db";
import {
  addAllow,
  isFamilyAllowed,
  listAllow,
  parseAdminCommand,
  removeAllow,
} from "../src/messenger/discord-allowlist";

beforeEach(() => {
  getDb().run("DELETE FROM discord_allowlist");
});

test("discord_allowlist add/list/remove roundtrip", () => {
  addAllow("111111111111111111", "엄마");
  addAllow("222222222222222222");
  addAllow("111111111111111111", "어머니");

  expect(listAllow().map((row) => ({ user_id: row.user_id, name: row.name }))).toEqual([
    { user_id: "111111111111111111", name: "어머니" },
    { user_id: "222222222222222222", name: null },
  ]);

  removeAllow("222222222222222222");
  expect(listAllow().map((row) => row.user_id)).toEqual(["111111111111111111"]);
});

test("isFamilyAllowed fail-closed with admin bootstrap", () => {
  expect(isFamilyAllowed("999999999999999999", "999999999999999999")).toBe(true);
  expect(isFamilyAllowed("111111111111111111", "999999999999999999")).toBe(false);
  expect(isFamilyAllowed("", "")).toBe(false);

  addAllow("111111111111111111", "가족");
  expect(isFamilyAllowed("111111111111111111", "999999999999999999")).toBe(true);
});

test("parseAdminCommand parses valid commands and rejects invalid shapes", () => {
  expect(parseAdminCommand("!허용 111111111111111111 엄마")).toEqual({ cmd: "allow", userId: "111111111111111111", name: "엄마" });
  expect(parseAdminCommand(" !허용 111111111111111111 엄마 홍 ")).toEqual({ cmd: "allow", userId: "111111111111111111", name: "엄마 홍" });
  expect(parseAdminCommand("!허용 111111111111111111")).toEqual({ cmd: "allow", userId: "111111111111111111" });
  expect(parseAdminCommand("!차단 111111111111111111")).toEqual({ cmd: "block", userId: "111111111111111111" });
  expect(parseAdminCommand("!목록")).toEqual({ cmd: "list" });

  expect(parseAdminCommand(null)).toBeNull();
  expect(parseAdminCommand("안녕")).toBeNull();
  expect(parseAdminCommand("!허용")).toBeNull();
  expect(parseAdminCommand("!허용 123 엄마")).toBeNull();
  expect(parseAdminCommand("!차단 111111111111111111 엄마")).toBeNull();
  expect(parseAdminCommand("!목록 111111111111111111")).toBeNull();
});
