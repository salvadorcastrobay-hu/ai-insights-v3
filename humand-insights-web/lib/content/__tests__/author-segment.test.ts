import assert from "node:assert/strict";
import { test } from "node:test";

import { authorKind, authorRole, isTopVoice } from "../author-segment";

test("authorRole: el cargo ejecutivo gana aunque también diga RRHH", () => {
  assert.equal(authorRole("CEO | People & Culture | Speaker"), "ceo_fundador");
  assert.equal(authorRole("CHRO at Acme | Mentora"), "lider_rrhh");
  assert.equal(authorRole("Diretora de Pessoas na XP"), "lider_rrhh");
});

test("authorRole: RRHH operativo, consultor y empresa", () => {
  assert.equal(authorRole("Analista de RH | Graduanda em Psicologia"), "rrhh_operativo");
  assert.equal(authorRole("Recursos Humanos | Gestão Financeira"), "rrhh_operativo");
  assert.equal(authorRole("Coach ejecutiva y facilitadora"), "consultor_coach");
  assert.equal(authorRole("Plataforma de beneficios para empresas"), "empresa");
  assert.equal(authorRole("lo que sea", true), "empresa");
  assert.equal(authorRole(null), "otro");
});

test("isTopVoice lee el headline", () => {
  assert.equal(isTopVoice("Recruitment Expert ✪ LinkedIn Top Voice ✪ Author"), true);
  assert.equal(isTopVoice("Head of People"), false);
});

test("authorKind: gana la fuente más deliberada", () => {
  assert.equal(authorKind(["keyword", "profile"]), "referente");
  assert.equal(authorKind(["profile", "competitor_profile"]), "competitor");
  assert.equal(authorKind(["own_brand"]), "own_brand");
  assert.equal(authorKind(["hashtag"]), "descubierto");
  assert.equal(authorKind([]), "descubierto");
});

test("authorRole: los casos que el primer diccionario dejaba en otro", () => {
  assert.equal(authorRole("Plurix (Pátria Investimentos)People and Sustentability Vice-President"), "lider_rrhh");
  assert.equal(authorRole("President of @beUp. Guest Lecturer"), "ceo_fundador");
  assert.equal(authorRole("Socia Directora en Internal"), "ceo_fundador");
  assert.equal(authorRole("Consulting ◆ Training ◆ Coaching"), "consultor_coach");
  assert.equal(authorRole("Gestión de talento | Desarrollo Organizacional"), "rrhh_operativo");
  assert.equal(authorRole("Head of AI Strategy"), "otro", "head of a secas no es RRHH");
});
