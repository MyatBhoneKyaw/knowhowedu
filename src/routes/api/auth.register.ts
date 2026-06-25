import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { json, adminClient, publishableClient, shapeUser } = await import(
          "@/lib/knowhow-api.server"
        );
        const body = await request.json().catch(() => ({}));
        const { email, password, fullName, username, region, age, languages, interests } = body;
        if (!email || !password) return json({ message: "Email and password required" }, 400);

        const admin = adminClient();
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
            username,
            profile: {
              region: region || "",
              age: age ? Number(age) : undefined,
              languages: Array.isArray(languages) ? languages : [],
              interests: Array.isArray(interests) ? interests : [],
            },
          },
        });
        if (createErr || !created.user) {
          return json({ message: createErr?.message || "Registration failed" }, 400);
        }

        const pub = publishableClient();
        const { data: sess, error: signErr } = await pub.auth.signInWithPassword({ email, password });
        if (signErr || !sess.session) return json({ message: signErr?.message || "Login failed" }, 400);

        const { data: profile } = await admin.from("profiles").select("*").eq("id", created.user.id).single();
        return json({ token: sess.session.access_token, user: shapeUser(profile) });
      },
    },
  },
});
