import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

// Mounts the Knowhow MVP SPA at /admin so direct navigation / hard refresh
// shows the admin login or dashboard (the internal app reads
// window.location.pathname to switch into admin mode).
export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Admin – Know-how" }, { name: "robots", content: "noindex" }],
  }),
  component: KnowhowAdmin,
});

function KnowhowAdmin() {
  useEffect(() => {
    // @ts-expect-error: untyped JSX MVP module
    import("@/knowhow/main.jsx");
  }, []);
  return <div id="root" />;
}
