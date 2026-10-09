// Links people paste into the page (ads, stores, suppliers): completed to
// https and checked the way the database checks them (an https:// address
// without spaces, at most 2,000 characters).

export function cleanUrl(raw) {
  let url = String(raw ?? "").trim();
  if (!url) return { error: "Paste the link." };
  if (/^www\.|^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/|$)/i.test(url)) url = "https://" + url;
  if (/^http:\/\//i.test(url)) url = "https://" + url.slice(7);
  let parsed;
  try { parsed = new URL(url); } catch { return { error: "That is not a web address. Copy the link from the address bar." }; }
  if (parsed.protocol !== "https:" || /\s/.test(url)) return { error: "Use an https:// link." };
  if (url.length > 2000) return { error: "That link is too long." };
  return { url };
}

export const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
};

export function newId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const PRODUCT_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
