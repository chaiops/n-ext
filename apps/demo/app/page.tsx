export const dynamic = "force-dynamic";

export default async function Home() {
  const res = await fetch("https://jsonplaceholder.typicode.com/todos/1");
  const todo = await res.json();

  return (
    <main style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h1>n-ext demo</h1>
      <p>Server-side fetch captured. Open DevTools &rarr; n-ext tab to inspect.</p>
      <pre>{JSON.stringify(todo, null, 2)}</pre>
    </main>
  );
}
