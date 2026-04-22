import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCompetitor, normalizeRegion } from "../normalizers";

test("normalizeRegion maps aliases to official region labels", () => {
  assert.equal(normalizeRegion("latam"), "HISPAM");
  assert.equal(normalizeRegion("north america"), "ANGLO AMERICA");
  assert.equal(normalizeRegion("Brazil"), "Brazil");
});

test("normalizeCompetitor collapses known aliases", () => {
  assert.equal(normalizeCompetitor("buk hr"), "Buk");
  assert.equal(normalizeCompetitor("solids"), "Sólides");
  assert.equal(normalizeCompetitor("Unknown Vendor"), "Unknown Vendor");
});
