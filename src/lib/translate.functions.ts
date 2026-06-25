import { createServerFn } from "@tanstack/react-start";

const LANG_NAMES: Record<string, string> = {
  my: "Burmese (Myanmar)",
  "zh-CN": "Simplified Chinese",
  zh: "Simplified Chinese",
  en: "English",
};

export const translateBatch = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const d = data as { texts?: unknown; target?: unknown };
    if (!Array.isArray(d.texts)) throw new Error("texts must be array");
    if (typeof d.target !== "string") throw new Error("target required");
    return { texts: d.texts.map(String).slice(0, 200), target: d.target };
  })
  .handler(async ({ data }) => {
    const { texts, target } = data;
    if (!texts.length) return { translations: [] as string[] };
    if (target === "en") return { translations: texts };

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

    const targetName = LANG_NAMES[target] || target;
    const numbered = texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, " ")}`).join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are a translation engine. Translate every input line into ${targetName}. Preserve numbering exactly (e.g. "1. ...", "2. ..."). Do not add commentary. Keep brand names, emojis, URLs, numbers, and code as-is. Output only the translated numbered lines.`,
          },
          { role: "user", content: numbered },
        ],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Translation failed: ${res.status} ${err}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";

    const out: string[] = new Array(texts.length).fill("");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*(\d+)\.\s?(.*)$/);
      if (!m) continue;
      const idx = parseInt(m[1], 10) - 1;
      if (idx >= 0 && idx < texts.length) out[idx] = m[2];
    }
    // fallback to original if missing
    for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = texts[i];
    return { translations: out };
  });
