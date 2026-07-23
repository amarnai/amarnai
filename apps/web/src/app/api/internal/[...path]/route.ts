import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const API_BASE = process.env["API_URL"] ?? "http://localhost:3001";
const INTERNAL_SECRET = process.env["INTERNAL_API_SECRET"] ?? "dev-internal-secret";

type Ctx = { params: Promise<{ path: string[] }> };

async function proxyRequest(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.user;

  const { path } = await ctx.params;
  const apiPath = path.join("/");
  const search = req.nextUrl.search;
  const url = `${API_BASE}/${apiPath}${search}`;

  const method = req.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await req.text() : null;

  // Forward select client headers that carry per-request metadata.
  // Normalize to a literal "1" rather than forwarding raw user input verbatim.
  const forceRegenerate = req.headers.get("X-Force-Regenerate") === "1";

  const upstream = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${INTERNAL_SECRET}`,
      "X-User-Id": user.id,
      ...(hasBody ? { "Content-Type": req.headers.get("Content-Type") ?? "application/json" } : {}),
      ...(forceRegenerate ? { "X-Force-Regenerate": "1" } : {}),
    },
    body: body ?? null,
    cache: "no-store",
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: "API unavailable" }, { status: 502 });
  }

  // Pass the body through as raw bytes so binary responses (inline images) are
  // not corrupted the way `.text()` would corrupt them. JSON is a subset of this
  // — bytes-in, bytes-out — so existing routes behave identically.
  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  const buffer = await upstream.arrayBuffer();
  const headers = new Headers({ "Content-Type": contentType });
  // Forward caching / disposition / sniffing headers when present (image proxy).
  for (const h of ["Cache-Control", "Content-Disposition", "X-Content-Type-Options", "Content-Length"]) {
    const v = upstream.headers.get(h);
    if (v !== null) headers.set(h, v);
  }
  return new NextResponse(buffer, {
    status: upstream.status,
    headers,
  });
}

export function GET(req: NextRequest, ctx: Ctx)    { return proxyRequest(req, ctx); }
export function POST(req: NextRequest, ctx: Ctx)   { return proxyRequest(req, ctx); }
export function PATCH(req: NextRequest, ctx: Ctx)  { return proxyRequest(req, ctx); }
export function DELETE(req: NextRequest, ctx: Ctx) { return proxyRequest(req, ctx); }
