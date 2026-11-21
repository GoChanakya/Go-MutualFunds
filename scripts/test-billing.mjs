import assert from "node:assert/strict";
import { test } from "node:test";
import { paidThrough } from "../src/lib/billing/entitlement.ts";

test("authentication without a successful charge grants no access", () => {
  assert.equal(paidThrough(0, 0, 0, 2_000_000_000), 0);
});

test("a successful first charge starts the paid period", () => {
  assert.equal(paidThrough(0, 0, 1, 2_000_000_000), 2_000_000_000_000);
});

test("failed renewal cannot extend access even if current_end advances", () => {
  assert.equal(paidThrough(1, 2_000_000_000_000, 1, 2_003_000_000), 2_000_000_000_000);
});

test("successful renewal extends access exactly once", () => {
  assert.equal(paidThrough(1, 2_000_000_000_000, 2, 2_003_000_000), 2_003_000_000_000);
  assert.equal(paidThrough(2, 2_003_000_000_000, 2, 2_006_000_000), 2_003_000_000_000);
});

test("cancellation retains the already paid period", () => {
  assert.equal(paidThrough(1, 2_000_000_000_000, 1, null), 2_000_000_000_000);
});
