import { installFetchInterceptor } from "./fetch-interceptor";
import { installHttpInterceptor } from "./http-interceptor";
import { setRemoteMode } from "./event-store";
import { startSeeServer } from "../server/see-endpoint";

const INIT_KEY = Symbol.for("__n_ext_init__");
const g = globalThis as unknown as Record<symbol, boolean>;

if (!g[INIT_KEY]) {
  g[INIT_KEY] = true;

  // Start server first, then install interceptors
  // (so interceptor's http patches don't affect our own server)
  startSeeServer().then((isServer) => {
    if (!isServer) {
      // Server already running in another process — send events remotely
      setRemoteMode();
    }

    installHttpInterceptor();
    installFetchInterceptor();
    console.log(`[n-ext] Interceptors installed (${isServer ? "server" : "client"} mode)`);
  });
}
