import { translateBatch } from "./translate.functions";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA"]);
const ATTR_TARGETS: Array<{ tag?: string; attr: string }> = [
  { attr: "placeholder" },
  { attr: "title" },
  { attr: "aria-label" },
  { attr: "alt" },
  { tag: "INPUT", attr: "value" },
];
const CACHE_KEY = (lang: string) => `knowhow-tr-cache-${lang}`;
const BATCH_SIZE = 50;
const PARALLEL = 4;

type Target = { kind: "text"; node: Text } | { kind: "attr"; el: Element; attr: string };

let currentLang = "en";
let cache: Map<string, string> = new Map();
let observer: MutationObserver | null = null;
let pending: Target[] = [];
let seen = new WeakSet<object>();
let scheduleTimer: number | null = null;
let running = false;

function loadCache(lang: string) {
  cache = new Map();
  try {
    const raw = localStorage.getItem(CACHE_KEY(lang));
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(obj)) cache.set(k, v);
    }
  } catch (_) {}
}
function saveCache(lang: string) {
  try {
    const obj: Record<string, string> = {};
    cache.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(CACHE_KEY(lang), JSON.stringify(obj));
  } catch (_) {}
}

function translatable(s: string | null | undefined): boolean {
  if (!s) return false;
  const t = s.trim();
  if (t.length < 1) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  return true;
}

function isTranslatableText(node: Text): boolean {
  if (!translatable(node.nodeValue)) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  if (SKIP_TAGS.has(parent.tagName)) return false;
  if (parent.closest("[data-no-translate]")) return false;
  return true;
}

function collectFrom(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    if (isTranslatableText(root as Text)) pending.push({ kind: "text", node: root as Text });
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (el.closest("[data-no-translate]")) return;
  // attributes on this element
  for (const t of ATTR_TARGETS) {
    if (t.tag && el.tagName !== t.tag) continue;
    const v = el.getAttribute(t.attr);
    if (translatable(v)) pending.push({ kind: "attr", el, attr: t.attr });
  }
  // walk text nodes
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (isTranslatableText(n as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let n: Node | null;
  while ((n = walker.nextNode())) pending.push({ kind: "text", node: n as Text });
  // walk child elements for attribute scan
  const all = el.querySelectorAll("[placeholder],[title],[aria-label],[alt],input[value]");
  all.forEach((child) => {
    if (child.closest("[data-no-translate]")) return;
    for (const t of ATTR_TARGETS) {
      if (t.tag && child.tagName !== t.tag) continue;
      const v = child.getAttribute(t.attr);
      if (translatable(v)) pending.push({ kind: "attr", el: child, attr: t.attr });
    }
  });
}

function getKey(tgt: Target): string {
  if (tgt.kind === "text") return (tgt.node.nodeValue || "").trim();
  return (tgt.el.getAttribute(tgt.attr) || "").trim();
}
function applyTranslation(tgt: Target, translated: string) {
  if (tgt.kind === "text") {
    const original = tgt.node.nodeValue || "";
    const lead = original.match(/^\s*/)?.[0] ?? "";
    const trail = original.match(/\s*$/)?.[0] ?? "";
    const next = lead + translated + trail;
    if (tgt.node.nodeValue !== next) tgt.node.nodeValue = next;
  } else {
    if (tgt.el.getAttribute(tgt.attr) !== translated) tgt.el.setAttribute(tgt.attr, translated);
  }
}

async function run() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const batch = pending.splice(0, pending.length);
      // group by key
      const cachedApplied: Target[] = [];
      const uncached = new Map<string, Target[]>();
      for (const tgt of batch) {
        if (tgt.kind === "text" && !tgt.node.isConnected) continue;
        if (tgt.kind === "attr" && !tgt.el.isConnected) continue;
        const key = getKey(tgt);
        if (!key) continue;
        if (cache.has(key)) {
          applyTranslation(tgt, cache.get(key)!);
          cachedApplied.push(tgt);
        } else {
          if (!uncached.has(key)) uncached.set(key, []);
          uncached.get(key)!.push(tgt);
        }
      }
      if (!uncached.size) continue;
      const keys = Array.from(uncached.keys());
      // chunk and dispatch in parallel
      const chunks: string[][] = [];
      for (let i = 0; i < keys.length; i += BATCH_SIZE) chunks.push(keys.slice(i, i + BATCH_SIZE));
      for (let i = 0; i < chunks.length; i += PARALLEL) {
        const slice = chunks.slice(i, i + PARALLEL);
        await Promise.all(slice.map(async (chunk) => {
          try {
            const res = await translateBatch({ data: { texts: chunk, target: currentLang } });
            const translations = res.translations || [];
            chunk.forEach((k, idx) => {
              const t = translations[idx];
              if (t) cache.set(k, t);
            });
            for (const k of chunk) {
              const t = cache.get(k);
              if (!t) continue;
              const list = uncached.get(k) || [];
              for (const tgt of list) {
                if (tgt.kind === "text" && !tgt.node.isConnected) continue;
                if (tgt.kind === "attr" && !tgt.el.isConnected) continue;
                applyTranslation(tgt, t);
              }
            }
          } catch (e) {
            console.warn("translate chunk failed", e);
          }
        }));
        saveCache(currentLang);
      }
    }
  } finally {
    running = false;
    if (pending.length) schedule(50);
  }
}

function schedule(delay = 120) {
  if (scheduleTimer) window.clearTimeout(scheduleTimer);
  scheduleTimer = window.setTimeout(() => { scheduleTimer = null; run(); }, delay);
}

function queueAll() {
  pending = [];
  collectFrom(document.body);
  run();
}

function startObserver() {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => collectFrom(n));
      } else if (m.type === "characterData") {
        const n = m.target;
        if (n.nodeType === Node.TEXT_NODE && isTranslatableText(n as Text)) {
          pending.push({ kind: "text", node: n as Text });
        }
      } else if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE) {
        const el = m.target as Element;
        const attr = m.attributeName || "";
        if (["placeholder", "title", "aria-label", "alt", "value"].includes(attr)) {
          const v = el.getAttribute(attr);
          if (translatable(v)) pending.push({ kind: "attr", el, attr });
        }
      }
    }
    if (pending.length) schedule();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label", "alt", "value"],
  });
}

export function setTranslationLanguage(lang: string) {
  const code = lang === "Myanmar" ? "my" : lang === "Chinese" ? "zh-CN" : "en";
  if (code === currentLang) return;
  currentLang = code;
  if (code === "en") {
    observer?.disconnect();
    observer = null;
    window.location.reload();
    return;
  }
  loadCache(code);
  queueAll();
  startObserver();
}

export function initTranslator() {
  if (typeof window === "undefined") return;
  const saved = localStorage.getItem("knowhow-language") || "English";
  if (saved !== "English") {
    setTimeout(() => setTranslationLanguage(saved), 300);
  }
}
