import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Know-how – Time Bank & Skill Bartering Network" },
      {
        name: "description",
        content:
          "Know-how connects learners and teachers with a time-credit economy: search teachers, message, schedule sessions, join video rooms, and earn credits.",
      },
      { property: "og:title", content: "Know-how – Time Bank & Skill Bartering Network" },
      {
        property: "og:description",
        content: "Learn from real people, not random tabs. A time-bank and skill-bartering network.",
      },
    ],
  }),
  component: KnowhowApp,
});

function KnowhowApp() {
  useEffect(() => {
    // The MVP frontend self-mounts to #root via createRoot in main.jsx.
    import("@/knowhow/main.jsx");
  }, []);
  return <div id="root" />;
}
