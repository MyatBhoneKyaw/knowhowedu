import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/qualifications/teacher-applications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, requireUser, adminClient, shapeApplication } = await import(
          "@/lib/knowhow-api.server"
        );
        const { user } = await requireUser(request);
        const body = await request.json().catch(() => ({}));
        const admin = adminClient();
        const { data, error } = await admin
          .from("teacher_applications")
          .insert({
            user_id: user.id,
            subject: String(body.subject || ""),
            requested_role: String(body.requestedRole || "assistant_teacher"),
            learner_level: body.learnerLevel || null,
            teacher_level_claim: body.teacherLevelClaim || null,
            linked_in_url: body.linkedInUrl || null,
            cv_url: body.cvUrl || null,
            license_url: body.licenseUrl || null,
            authority_name: body.authorityName || null,
            note: body.note || null,
          })
          .select("*")
          .single();
        if (error) return json({ message: error.message }, 400);
        return json(shapeApplication(data));
      },
    },
  },
});
