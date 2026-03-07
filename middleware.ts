import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getConfig } from "./lib/config";

export function middleware(request: NextRequest) {
  const nniConfig = getConfig();
  const existing = request.cookies.get(nniConfig.cookieName)?.value;
  if (existing) return NextResponse.next();

  const response = NextResponse.next();
  response.cookies.set(nniConfig.cookieName, globalThis.crypto.randomUUID(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/nni).*)",
  ],
};
