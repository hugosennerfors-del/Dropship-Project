import type { Config, Context } from "@netlify/edge-functions";

/**
 * Basic auth framför hela sidan.
 *
 * Netlifys inbyggda lösenordsskydd kräver betalplan. Det här gör samma sak på
 * gratisplanen: edge functions ingår.
 *
 * Funktionen FELAR STÄNGT. Saknas SITE_USER eller SITE_PASSWORD svarar den 503
 * i stället för att släppa förbi. En felkonfiguration ska aldrig kunna lägga
 * omsättning och inköpspris öppet på nätet — det är hela poängen med grinden.
 */

const REALM = "Plan-vy Intelligence";

/** Jämför utan att läcka via svarstid. Längden läcker, och det är acceptabelt. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function challenge(): Response {
  return new Response("Autentisering krävs.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default async (req: Request, context: Context): Promise<Response> => {
  const user = Netlify.env.get("SITE_USER");
  const password = Netlify.env.get("SITE_PASSWORD");

  if (!user || !password) {
    return new Response(
      "Sidan är inte konfigurerad: SITE_USER och SITE_PASSWORD saknas. " +
        "Åtkomst nekas tills de är satta.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return challenge();

  let decoded: string;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return challenge();
  }

  // Lösenord får innehålla kolon; användarnamnet får inte. Dela på första.
  const sep = decoded.indexOf(":");
  if (sep === -1) return challenge();

  const okUser = safeEqual(decoded.slice(0, sep), user);
  const okPass = safeEqual(decoded.slice(sep + 1), password);
  // Utvärdera alltid båda, så svarstiden inte avslöjar vilket som var fel.
  if (!(okUser && okPass)) return challenge();

  const res = await context.next();

  // Egna headers från netlify.toml gäller inte på vägar som en edge function
  // serverar, så de sätts här i stället.
  const out = new Response(res.body, res);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  out.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  return out;
};

export const config: Config = {
  path: "/*",
};
