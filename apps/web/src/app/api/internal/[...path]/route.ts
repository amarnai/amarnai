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

  const upstream = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${INTERNAL_SECRET}`,
      "X-User-Id": user.id,
      ...(hasBody ? { "Content-Type": req.headers.get("Content-Type") ?? "application/json" } : {}),
    },
    body: body ?? null,
    cache: "no-store",
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ error: "API unavailable" }, { status: 502 });
  }

  const contentType = upstream.headers.get("Content-Type") ?? "application/json";
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": contentType },
  });
}

export function GET(req: NextRequest, ctx: Ctx)    { return proxyRequest(req, ctx); }
export function POST(req: NextRequest, ctx: Ctx)   { return proxyRequest(req, ctx); }
export function PATCH(req: NextRequest, ctx: Ctx)  { return proxyRequest(req, ctx); }
export function DELETE(req: NextRequest, ctx: Ctx) { return proxyRequest(req, ctx); }
