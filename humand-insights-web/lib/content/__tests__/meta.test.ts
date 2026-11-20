import assert from "node:assert/strict";
import { test } from "node:test";

import { leadsFrom, mapGraphMedia, parseInsights, shortcodeFromPermalink, toOwnAdRow } from "../meta";
import { computeFeatures } from "../post-features";
import { ownForRegion } from "../pipeline";

test("el shortcode sale de cualquier forma de permalink", () => {
  assert.equal(shortcodeFromPermalink("https://www.instagram.com/p/DfkVq1NsLeD/"), "DfkVq1NsLeD");
  assert.equal(shortcodeFromPermalink("https://www.instagram.com/reel/ABC_123-x/?igsh=1"), "ABC_123-x");
  assert.equal(shortcodeFromPermalink("https://www.instagram.com/humand.br/p/XYZ/"), "XYZ");
  assert.equal(shortcodeFromPermalink(null), null);
  assert.equal(shortcodeFromPermalink("https://example.com/p/nope"), null);
});

test("insights: toma cada métrica y deja null lo que no vino", () => {
  const parsed = parseInsights({
    data: [
      { name: "reach", values: [{ value: 392 }] },
      { name: "views", values: [{ value: 554 }] },
      { name: "shares", total_value: { value: 5 } },
      { name: "otra", values: [{ value: 1 }] },
    ],
  });
  assert.deepEqual(parsed, { reach: 392, views: 554, saved: null, shares: 5, total_interactions: null });
});

test("un reel de la Graph API queda como lo guarda Apify: shortcode, video, clips", () => {
  const post = mapGraphMedia(
    {
      id: "1",
      media_type: "VIDEO",
      media_product_type: "REELS",
      media_url: "https://cdn/v.mp4",
      thumbnail_url: "https://cdn/t.jpg",
      permalink: "https://www.instagram.com/reel/AbC/",
      timestamp: "2026-11-01T12:00:00+0000",
      caption: "Hola #rrhh con @humand.es",
      like_count: 20,
      comments_count: 3,
    },
    { username: "humand.br", followers_count: 5435 },
    { reach: 392, views: 554, saved: 0, shares: 5, total_interactions: 29 },
  );
  assert.ok(post);
  assert.equal(post.post_id, "AbC");
  assert.equal(post.format, "video");
  assert.equal(post.author_handle, "humand.br");
  assert.equal(post.video_views, 554);
  assert.equal(post.shares_count, 5);
  assert.deepEqual(post.hashtags, ["rrhh"]);
  assert.deepEqual(post.mentions, ["humand.es"]);
  assert.deepEqual(post.media, { images: ["https://cdn/t.jpg"], videos: ["https://cdn/v.mp4"] });
  assert.equal((post.raw as { productType: string }).productType, "clips");
  assert.equal(post.native_insights?.reach, 392);
  // computeFeatures lee el raw como si fuera de Apify: tiene que reconocer el reel.
  assert.equal(computeFeatures(post, "br").format_detail, "reel");
});

test("un carrusel cuenta sus láminas igual que con Apify", () => {
  const post = mapGraphMedia(
    {
      id: "2",
      media_type: "CAROUSEL_ALBUM",
      media_url: "https://cdn/1.jpg",
      permalink: "https://www.instagram.com/p/Car/",
      children: {
        data: [
          { id: "a", media_type: "IMAGE", media_url: "https://cdn/1.jpg" },
          { id: "b", media_type: "IMAGE", media_url: "https://cdn/2.jpg" },
          { id: "c", media_type: "IMAGE", media_url: "https://cdn/3.jpg" },
        ],
      },
    },
    { username: "humand.br" },
    null,
  );
  assert.ok(post);
  assert.equal(post.format, "sidecar");
  assert.equal(post.media.images.length, 3);
  assert.equal(post.native_insights, null);
  assert.equal(computeFeatures(post, "br").slide_count, 3);
});

test("sin permalink ni shortcode no hay post", () => {
  assert.equal(mapGraphMedia({ id: "3", media_type: "IMAGE" }, { username: "x" }, null), null);
});

test("leads: toma la acción de lead y no suma las demás", () => {
  assert.equal(
    leadsFrom([
      { action_type: "link_click", value: "2" },
      { action_type: "lead", value: "1" },
      { action_type: "offsite_complete_registration_add_meta_leads", value: "1" },
    ]),
    1,
  );
  assert.equal(leadsFrom([{ action_type: "link_click", value: "2" }]), 0);
  assert.equal(leadsFrom(undefined), 0);
});

test("fila de ad: números parseados y el post de Instagram que usa", () => {
  const row = toOwnAdRow(
    { id: "act_1", account_id: "1", name: "CA_HUMAND_LATAM", currency: "ARS", account_status: 1 },
    { ad_id: "9", ad_name: "ad3", campaign_name: "leadgen", spend: "13624.83", impressions: "381", reach: "313", clicks: "4", actions: [{ action_type: "lead", value: "1" }] },
    { id: "9", effective_status: "ACTIVE", creative: { instagram_permalink_url: "https://www.instagram.com/p/DfkVq1NsLeD/", thumbnail_url: "t", body: "b" } },
    { since: "2026-08-12", until: "2026-11-10" },
  );
  assert.equal(row.spend, 13624.83);
  assert.equal(row.impressions, 381);
  assert.equal(row.leads, 1);
  assert.equal(row.ig_shortcode, "DfkVq1NsLeD");
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.currency, "ARS");
});

test("lo propio se compara con su mercado: Brasil no entra en HISPAM", () => {
  const own = [
    { id: "es", region: "hispam" },
    { id: "br", region: "br" },
    { id: "li", region: "global" },
  ];
  const ids = (r: string) => ownForRegion(own, r).map((p) => p.id).sort();
  assert.deepEqual(ids("hispam"), ["es", "li"]);
  assert.deepEqual(ids("br"), ["br", "li"]);
  // España no tiene cuenta propia: lo de antes, sin Brasil.
  assert.deepEqual(ids("es"), ["es", "li"]);
});
