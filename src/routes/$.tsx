import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

// Catch-all so the internal Knowhow SPA router (hash-less paths like /admin,
// /teachers, /messages, etc.) is handled by the mounted MVP app instead of
// TanStack's 404 boundary.
export const Route = createFileRoute("/$")({
  component: KnowhowApp,
});

function KnowhowApp() {
  useEffect(() => {
    // @ts-expect-error: untyped JSX MVP module
    import("@/knowhow/main.jsx");
  }, []);
  return <div id="root" />;
}
