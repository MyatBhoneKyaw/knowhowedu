import { translateBatch } from "./translate.functions";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA", "INPUT", "SELECT", "OPTION"]);
const CACHE_KEY = (lang: string) => `knowhow-tr-cache-${lang}`;

type TranslateFn = typeof translateBatch;

let currentLang = "en";
let cache: Map<string, string> = new Map();
let observer: MutationObserver | null = null;
let pending: Set<Text> = new Set();
let scheduleTimer: number | null = null;
let inflight = false;

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

function isTranslatableText(node: Text): boolean {
  const t = node.nodeValue;
  if (!t) return false;
  const trimmed = t.trim();
  if (trimmed.length < 2) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  const parent = node.parentElement;
  if (!parent) return false;
  if (SKIP_TAGS.has(parent.tagName)) return false;
  if (parent.closest("[data-no-translate]")) return false;
  return true;
}

function collectTextNodes(root: Node, into: Text[]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (isTranslatableText(n as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  let n: Node | null;
  while ((n = walker.nextNode())) into.push(n as Text);
}

function applyCached(node: Text) {
  const original = node.nodeValue || "";
  const key = original.trim();
  const translated = cache.get(key);
  if (translated && translated !== key) {
    // preserve leading/trailing whitespace
    const lead = original.match(/^\s*/)?.[0] ?? "";
    const trail = original.match(/\s*$/)?.[0] ?? "";
    if (node.nodeValue !== lead + translated + trail) {
      node.nodeValue = lead + translated + trail;
    }
    return true;
  }
  return false;
}

async function flush() {
  if (inflight) { schedule(); return; }
  const nodes = Array.from(pending);
  pending.clear();
  if (!nodes.length) return;
  // Apply cached & collect uncached
  const uncached = new Map<string, Text[]>();
  for (const node of nodes) {
    if (!node.isConnected) continue;
    const key = (node.nodeValue || "").trim();
    if (!key) continue;
    if (cache.has(key)) {
      applyCached(node);
    } else {
      if (!uncached.has(key)) uncached.set(key, []);
      uncached.get(key)!.push(node);
    }
  }
  if (!uncached.size) return;
  const keys = Array.from(uncached.keys()).slice(0, 80);
  inflight = true;
  try {
    const res = await translateBatch({ data: { texts: keys, target: currentLang } });
    const translations = res.translations || [];
    keys.forEach((k, i) => {
      const t = translations[i];
      if (t) cache.set(k, t);
    });
    saveCache(currentLang);
    for (const [key, list] of uncached) {
      for (const node of list) if (node.isConnected) applyCached(node);
    }
  } catch (e) {
    console.warn("translate failed", e);
  } finally {
    inflight = false;
    if (pending.size) schedule();
  }
}

function schedule() {
  if (scheduleTimer) window.clearTimeout(scheduleTimer);
  scheduleTimer = window.setTimeout(() => { scheduleTimer = null; flush(); }, 250);
}

function queueAll() {
  const nodes: Text[] = [];
  collectTextNodes(document.body, nodes);
  nodes.forEach((n) => pending.add(n));
  schedule();
}

function startObserver() {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "childList") {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE && isTranslatableText(n as Text)) {
            pending.add(n as Text);
          } else if (n.nodeType === Node.ELEMENT_NODE) {
            const arr: Text[] = [];
            collectTextNodes(n, arr);
            arr.forEach((t) => pending.add(t));
          }
        });
      } else if (m.type === "characterData") {
        const n = m.target;
        if (n.nodeType === Node.TEXT_NODE && isTranslatableText(n as Text)) {
          pending.add(n as Text);
        }
      }
    }
    if (pending.size) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function setTranslationLanguage(lang: string) {
  const code = lang === "Myanmar" ? "my" : lang === "Chinese" ? "zh-CN" : "en";
  if (code === currentLang) return;
  currentLang = code;
  if (code === "en") {
    observer?.disconnect();
    observer = null;
    // simplest way to restore originals: reload
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
    setTimeout(() => setTranslationLanguage(saved), 500);
  }
}
