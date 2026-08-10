import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/server/site";

export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "96px",
        background: "#0f172a",
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 128, fontWeight: 700, letterSpacing: "-0.03em" }}>{SITE_NAME}</div>
      <div style={{ marginTop: 24, fontSize: 44, color: "#cbd5e1", lineHeight: 1.3 }}>
        {SITE_TAGLINE}
      </div>
      <div
        style={{
          marginTop: 56,
          height: 12,
          width: 240,
          borderRadius: 999,
          background: "#1d4ed8",
        }}
      />
    </div>,
    size,
  );
}
