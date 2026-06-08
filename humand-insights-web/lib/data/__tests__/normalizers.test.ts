import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCompetitor,
  normalizeCountry,
  normalizeIndustry,
  normalizeRegion,
} from "../normalizers";

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

test("normalizeCountry consolida duplicados (acento/ES-EN)", () => {
  assert.equal(normalizeCountry("Brazil"), "Brasil");
  assert.equal(normalizeCountry("Mexico"), "México");
  assert.equal(normalizeCountry("Panama"), "Panamá");
  assert.equal(normalizeCountry("USA"), "Estados Unidos");
  assert.equal(normalizeCountry("United States"), "Estados Unidos");
  assert.equal(normalizeCountry("Republica Dominicana"), "República Dominicana");
  // passthrough de no mapeados
  assert.equal(normalizeCountry("Argentina"), "Argentina");
  assert.equal(normalizeCountry(null), null);
});

test("normalizeIndustry mergea misma industria y prettifica enums", () => {
  // merge de variantes a un canónico
  assert.equal(normalizeIndustry("FINANCIAL_SERVICES"), "Financial services");
  assert.equal(normalizeIndustry("Financial Services"), "Financial services");
  assert.equal(normalizeIndustry("Real State"), "Real Estate");
  assert.equal(normalizeIndustry("HUMAN_RESOURCES"), "HR/Staffing Services");
  // solo renombrar (queda separada)
  assert.equal(normalizeIndustry("CONSUMER_SERVICES"), "Consumer Services");
  // prettify de snake_case desconocido
  assert.equal(normalizeIndustry("SOME_NEW_THING"), "Some New Thing");
  // passthrough
  assert.equal(normalizeIndustry("Servicios"), "Servicios");
  assert.equal(normalizeIndustry(null), null);
});
