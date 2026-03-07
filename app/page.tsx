import { withFingerprint } from "@/lib/with-fingerprint";

export const dynamic = "force-dynamic";

export default async function Home() {
  const todo = await withFingerprint(async () => {
    const res = await fetch("https://jsonplaceholder.typicode.com/todos/1");
    return res.json();
  });

  return (
    <main style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h1>NNI - Next.js Network Inspector</h1>
      <p>Server-side fetch captured. Open DevTools → NNI tab to inspect.</p>
      <pre>{JSON.stringify(todo, null, 2)}</pre>
    </main>
  );
}
