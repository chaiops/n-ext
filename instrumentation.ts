export async function register() {
  if (process.env.NODE_ENV === "development") {
    const { installInterceptor } = await import("./lib/interceptor");
    installInterceptor();
  }
}
