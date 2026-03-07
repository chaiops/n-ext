export async function register() {
  const { getConfig } = await import("./lib/config");
  const config = getConfig();
  if (config.enabled) {
    const { installInterceptor } = await import("./lib/interceptor");
    installInterceptor();
  }
}
