import { cookies } from "next/headers";
import { setFingerprint } from "./interceptor";

export async function withFingerprint<T>(fn: () => T | Promise<T>): Promise<T> {
  const cookieStore = await cookies();
  const fp = cookieStore.get("__nni_fp")?.value;
  setFingerprint(fp);
  try {
    return await fn();
  } finally {
    setFingerprint(undefined);
  }
}
