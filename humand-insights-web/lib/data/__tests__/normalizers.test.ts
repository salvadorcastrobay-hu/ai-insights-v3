import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCompetitor, normalizeRegion } from "../normalizers";

test("normalizeRegion maps aliases to official region labels", () => {
  assert.equal(normalizeRegion("latam"), "HISPAM");
  assert.equal(normalizeRegion("north america"), "ANGLO AMERICA");
  assert.equal(normalizeRegion("Brazil"), "Brazil");
});

test("normalizeRegion falls back to country when region is a city/province", () => {
  // HubSpot region trae cosas como "Montevideo Department" — el país manda.
  assert.equal(normalizeRegion("Montevideo Department", "Uruguay"), "HISPAM");
  assert.equal(normalizeRegion("Île-de-France", "France"), "EMEA");
  assert.equal(normalizeRegion("Texas", "United States"), "ANGLO AMERICA");
  assert.equal(normalizeRegion("Balearic Islands", "Spain"), "EMEA");
  assert.equal(normalizeRegion("Valle del Cauca", "Colombia"), "HISPAM");
  assert.equal(normalizeRegion("Guanajuato", "Mexico"), "HISPAM");
});

test("normalizeRegion returns null when neither region nor country is mappable", () => {
  assert.equal(normalizeRegion("Atlantis", "Wakanda"), null);
  assert.equal(normalizeRegion(null, null), null);
  assert.equal(normalizeRegion("Some City", null), null);
});

test("normalizeCompetitor collapses known aliases", () => {
  assert.equal(normalizeCompetitor("buk hr"), "Buk");
  assert.equal(normalizeCompetitor("solids"), "Sólides");
  assert.equal(normalizeCompetitor("Unknown Vendor"), "Unknown Vendor");
});
