// "Copy this ad": GetHookd's clone ads. create_clone_ad makes new images
// from a competitor's ad (its image, or a video's poster frame) with an image
// model; get_clone_ad is polled until they are ready. The edge function makes
// the calls with the key from Vault and keeps small JPEG copies of the images
// in the database, because the page cannot load images from other sites and
// GetHookd's links expire after about a day.
//
// Billing (from GetHookd's tool descriptions): create_clone_ad costs one
// public-API credit unit now plus the model's credits per image delivered;
// get_clone_ad costs one credit unit per call; get_ad and
// list_clone_ad_models are free.

import { callTool, HookdError } from "./gethookd.js";

// The models list_clone_ad_models answered on 26 Oct 2026. The page offers
// these; the edge function checks the live list again before it spends.
export const CLONE_MODELS = [
  { slug: "nano-banana-2", name: "Nano Banana 2", credits: 1 },
  { slug: "nano-banana-pro", name: "Nano Banana Pro", credits: 2 },
  { slug: "gpt-image", name: "GPT Image 2", credits: 2 },
];
// Accepted by create_clone_ad (4:5 is not): feed square, stories and reels,
// and the portrait closest to Meta's 4:5 feed format.
export const CLONE_ASPECTS = { "1:1": "Square (1:1)", "9:16": "Portrait (9:16)", "3:4": "Portrait (3:4)" };
export const CLONE_MAX_VARIATIONS = 4;
// create_clone_ad's `language` is a name from GetHookd's language table.
const LANGUAGE = { UK: "English", SE: "Swedish" };

const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const str = (x, n) => (x == null ? null : String(x).replace(/\s+/g, " ").trim().slice(0, n) || null);
const fail = (json, what) => { throw new HookdError("api", str(json?.message || json?.error?.message || json?.code, 300) || what); };

// The most a copy can cost: one unit now (0.01 credit) and the model's
// credits for every image, when every image arrives.
export function cloneCost(model, variations) {
  const m = CLONE_MODELS.find((x) => x.slug === model);
  return m ? Math.round((0.01 + m.credits * variations) * 100) / 100 : null;
}

export function cloneArguments({ adId, model, aspect, variations, market }) {
  const ad = Number(adId);
  if (!Number.isSafeInteger(ad) || ad < 1) throw new HookdError("input", "The ad has no GetHookd id.");
  if (!CLONE_MODELS.some((m) => m.slug === model)) throw new HookdError("input", `Unknown image model ${String(model).slice(0, 40)}.`);
  if (!CLONE_ASPECTS[aspect]) throw new HookdError("input", "Pick 1:1, 9:16 or 3:4.");
  const n = Math.round(Number(variations));
  if (!(n >= 1 && n <= CLONE_MAX_VARIATIONS)) throw new HookdError("input", `Ask for 1 to ${CLONE_MAX_VARIATIONS} images.`);
  return { ad_id: ad, model_slug: model, aspect_ratio: CLONE_ASPECTS[aspect], variations_count: n, language: LANGUAGE[market] || "English" };
}

// The model must still be offered (free): a model GetHookd dropped would be
// refused anyway, but this says so in our words.
export async function checkModel({ key, fetch, model }) {
  const json = await callTool({ key, fetch, name: "list_clone_ad_models", args: {} });
  if (json?.errors) fail(json, "GetHookd could not list its image models.");
  const live = (Array.isArray(json?.data) ? json.data : []).find((m) => m?.slug === model);
  if (!live) throw new HookdError("input", `GetHookd no longer offers the image model ${model}. Pick another.`);
  return { slug: live.slug, credits: num(live.credits_per_variation) };
}

// GetHookd's answer to create_clone_ad \u2192 the generation's id and what it
// says it will charge.
export function readStart(json) {
  if (json?.errors) fail(json, "GetHookd did not start the copy.");
  const id = num(json?.data?.id);
  if (!id) throw new HookdError("format", "GetHookd started no copy.");
  const b = json?.billing || json?.data?.billing || json?.meta?.billing || {};
  return {
    cloneId: id,
    billing: { now: num(b.immediate_used_credits ?? json?.used_credits), atMost: num(b.total_expected_used_credits), remaining: num(json?.remaining_credits) },
  };
}

export async function startClone({ key, fetch, args }) {
  return readStart(await callTool({ key, fetch, name: "create_clone_ad", args }));
}

// One get_clone_ad answer \u2192 where the generation stands and its images.
// A prompt is in_progress, completed or failed; completed may hold fewer
// images than asked for.
export function readClone(json) {
  if (json?.errors) fail(json, "GetHookd could not read the copy.");
  const prompts = Array.isArray(json?.data?.prompts) ? json.data.prompts : [];
  if (!prompts.length) return { status: "in_progress", images: [], error: null, missing: null };
  const st = prompts.map((p) => (p?.status === "completed" || p?.status === "failed" ? p.status : "in_progress"));
  const images = prompts.flatMap((p) => (Array.isArray(p?.media) ? p.media : []))
    .filter((m) => m?.role === "generated" && num(m.id) && /^https:\/\/static-gp\.gethookd\.ai\//.test(String(m.url || "")))
    .map((m) => ({ mediaId: num(m.id), url: String(m.url) }));
  const status = st.includes("in_progress") ? "in_progress" : st.every((s) => s === "failed") ? "failed" : "completed";
  return {
    status, images,
    error: status === "failed" ? str(prompts.find((p) => p?.error)?.error, 300) || "GetHookd could not make the images." : null,
    missing: prompts.reduce((n, p) => n + (num(p?.missing_variations) || 0), 0),
    remaining: num(json?.remaining_credits),
  };
}

export async function getClone({ key, fetch, cloneId }) {
  return readClone(await callTool({ key, fetch, name: "get_clone_ad", args: { clone_ad_id: Number(cloneId) } }));
}

// The original ad's words, for the review and for Claude's rewrite (get_ad
// is free). Its image link is GetHookd's own thumbnail.
export function readSource(json) {
  if (json?.errors) fail(json, "GetHookd could not read the ad.");
  const d = json?.data || {};
  const transcript = (Array.isArray(d.transcripts) ? d.transcripts : []).map((t) => t?.content).find(Boolean);
  const img = String(d.primary_image_url || "");
  return {
    advertiser: str(d.brand?.name, 200), hook: str(d.hook, 300), title: str(d.title, 200), body: str(d.body, 2000),
    cta: str(d.cta_text, 60), linkDescription: str(d.link_description, 200), transcript: str(transcript, 2000),
    format: str(d.asset_type, 40), language: str(d.language, 10),
    imageUrl: /^https:\/\/app\.gethookd\.ai\/api\/v1\/media\//.test(img) ? img : null,
  };
}

export async function getSource({ key, fetch, adId }) {
  return readSource(await callTool({ key, fetch, name: "get_ad", args: { ad_id: Number(adId) } }));
}

// An image from GetHookd's own hosts only, at most 15 MB.
export const IMAGE_HOSTS = /^https:\/\/(static-gp\.gethookd\.ai|app\.gethookd\.ai)\//;
export async function fetchImage({ fetch, url, max = 15e6 }) {
  if (!IMAGE_HOSTS.test(String(url || ""))) throw new HookdError("input", "Not a GetHookd image.");
  const res = await fetch(url, { redirect: "error" });
  if (!res.ok) throw new HookdError("http", `The image answered ${res.status}${res.status === 403 ? " (its link has expired)" : ""}.`);
  if (Number(res.headers?.get?.("content-length")) > max) throw new HookdError("size", "The image is too large to copy.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > max) throw new HookdError("size", "The image is too large to copy.");
  return bytes;
}
