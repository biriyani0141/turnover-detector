"use client";

const BASE_BG = "#17171a";

export default function RootError({ error }: { error: Error & { digest?: string } }) {
  return (
    <pre style={{ background: BASE_BG, color: "#f87171", padding: 16, minHeight: "100vh" }}>
      ERROR: {error.message}
    </pre>
  );
}
