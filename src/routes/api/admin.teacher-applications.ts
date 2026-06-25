import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/teacher-applications")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json, requireAdmin, adminClient, shapeApplication } = await import(
          "@/lib/knowhow-api.server"
        );
        await requireAdmin(request);
        const admin = adminClient();
        const { data, error } = await admin
          .from("teacher_applications")
          .select("*, user:profiles!teacher_applications_user_id_fkey(id, full_name, username, email)")
          .order("created_at", { ascending: false });
        if (error) return json({ message: error.message }, 400);
        return json((data || []).map(shapeApplication));
      },
    },
  },
});
