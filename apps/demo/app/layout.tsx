import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "n-ext demo",
  description: "Demo app for n-ext server devtools",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
