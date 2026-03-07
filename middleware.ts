import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "__nni_fp";

export function middleware(request: NextRequest) {
  const existing = request.cookies.get(COOKIE_NAME)?.value;
  if (existing) return NextResponse.next();

  const response = NextResponse.next();
  response.cookies.set(COOKIE_NAME, globalThis.crypto.randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
