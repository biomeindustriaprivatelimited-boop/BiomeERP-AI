"use client";

/** Last resort: the whole layout failed. Plain HTML, no app styles. */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0b1210", color: "#e6efe9", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", maxWidth: 480, padding: 24 }}>
          <p style={{ fontSize: 18, fontWeight: 700 }}>Biome hit a problem</p>
          <p style={{ fontSize: 13, opacity: 0.75 }}>{error?.message || "The app could not draw this screen."}</p>
          <button onClick={() => reset()} style={{ marginTop: 16, padding: "8px 18px", borderRadius: 10, border: 0, background: "#3f7d4e", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Try again</button>
          <button onClick={() => { location.href = "/"; }} style={{ marginTop: 16, marginLeft: 8, padding: "8px 18px", borderRadius: 10, border: "1px solid #3f7d4e", background: "transparent", color: "#e6efe9", cursor: "pointer" }}>Home</button>
        </div>
      </body>
    </html>
  );
}
