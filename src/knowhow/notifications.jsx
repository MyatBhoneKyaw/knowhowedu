import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../integrations/supabase/client';

const STORAGE_PREFIX = 'knowhow.notifications.';
const EVENT_NAME = 'knowhow:notify';
const MAX_ITEMS = 50;

function keyFor(userId) {
  return `${STORAGE_PREFIX}${userId || 'guest'}`;
}

function loadAll(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveAll(userId, items) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {}
}

function mapRowToItem(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    read: !!row.is_read,
    category: row.type || 'system',
    title: row.title || 'Notification',
    body: row.body || '',
    icon: iconFor(row.type),
    remote: true,
  };
}

function mergeItems(local, remote) {
  const seen = new Set();
  const out = [];
  for (const it of [...remote, ...local]) {
    if (!it?.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, MAX_ITEMS);
}

export async function notify(userId, payload) {
  if (!userId) return;
  const category = payload.category || 'system';
  const item = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `n_${Date.now()}_${Math.random()}`,
    createdAt: new Date().toISOString(),
    read: false,
    category,
    title: payload.title || 'Notification',
    body: payload.body || '',
    icon: payload.icon || iconFor(category),
  };
  // Persist to Supabase so the recipient sees it on their device.
  try {
    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: userId, title: item.title, body: item.body, type: category, is_read: false })
      .select()
      .single();
    if (!error && data) {
      item.id = data.id;
      item.createdAt = data.created_at;
      item.remote = true;
    }
  } catch {}
  // Also cache locally so the current tab sees it immediately (only for self).
  try {
    const list = [item, ...loadAll(userId)].slice(0, MAX_ITEMS);
    saveAll(userId, list);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { userId } }));
  } catch {}
  return item;
}

function iconFor(category) {
  switch (category) {
    case 'reschedule': return '🗓️';
    case 'report': return '🛡️';
    case 'reminder': return '⏰';
    case 'credit-gain': return '💰';
    case 'credit-loss': return '💸';
    case 'promo': return '🎁';
    case 'transaction': return '🧾';
    default: return '🔔';
  }
}

const PROMO_POOL = [
  { category: 'promo', title: 'Bundle deal', body: 'Pick up 5 credits for just $22 — your best per-credit rate.' },
  { category: 'promo', title: 'Invite a friend', body: 'Refer a learner and you both earn bonus credits when they finish their first session.' },
  { category: 'promo', title: 'Daily reward ready', body: 'Open your wallet to claim today’s free credit boost.' },
  { category: 'promo', title: 'New skills weekly', body: 'Browse trending sessions — fresh mentors are joining every day.' },
  { category: 'transaction', title: 'Statement reminder', body: 'Review your recent credit activity in the wallet panel.' },
  { category: 'promo', title: 'Become a teacher', body: 'Share what you know — apply to teach and start earning credits.' },
];

function maybeFirePromo(userId) {
  if (!userId) return;
  const lastKey = `${STORAGE_PREFIX}lastpromo.${userId}`;
  const lastAt = Number(localStorage.getItem(lastKey) || 0);
  const now = Date.now();
  if (now - lastAt < 30 * 60 * 1000) return;
  const item = PROMO_POOL[Math.floor(Math.random() * PROMO_POOL.length)];
  notify(userId, item);
  localStorage.setItem(lastKey, String(now));
}

export function useNotifications(userId) {
  const [items, setItems] = useState(() => loadAll(userId));

  // Hydrate from Supabase and subscribe to realtime inserts.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    async function load() {
      try {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(MAX_ITEMS);
        if (!active || error || !Array.isArray(data)) return;
        const remote = data.map(mapRowToItem);
        const merged = mergeItems(loadAll(userId), remote);
        saveAll(userId, merged);
        setItems(merged);
      } catch {}
    }
    load();
    const poll = setInterval(load, 20 * 1000);
    let channel;
    try {
      channel = supabase
        .channel(`notif-${userId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
          const item = mapRowToItem(payload.new);
          const merged = mergeItems([item], loadAll(userId));
          saveAll(userId, merged);
          setItems(merged);
        })
        .subscribe();
    } catch {}
    return () => {
      active = false;
      clearInterval(poll);
      if (channel) { try { supabase.removeChannel(channel); } catch {} }
    };
  }, [userId]);

  useEffect(() => {
    setItems(loadAll(userId));
    function handler(e) {
      if (!e?.detail || e.detail.userId === userId) setItems(loadAll(userId));
    }
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener('storage', handler);
    };
  }, [userId]);

  async function markAllRead() {
    const next = loadAll(userId).map((n) => ({ ...n, read: true }));
    saveAll(userId, next);
    setItems(next);
    try { await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false); } catch {}
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { userId } }));
  }
  async function clearAll() {
    saveAll(userId, []);
    setItems([]);
    try { await supabase.from('notifications').delete().eq('user_id', userId); } catch {}
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { userId } }));
  }
  async function remove(id) {
    const next = loadAll(userId).filter((n) => n.id !== id);
    saveAll(userId, next);
    setItems(next);
    try { await supabase.from('notifications').delete().eq('id', id); } catch {}
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { userId } }));
  }

  return { items, unread: items.filter((n) => !n.read).length, markAllRead, clearAll, remove };
}

function timeAgo(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function NotificationBell({ userId, sessions = [] }) {
  const [open, setOpen] = useState(false);
  const { items, unread, markAllRead, clearAll, remove } = useNotifications(userId);
  const ref = useRef(null);

  useEffect(() => {
    if (!userId) return;
    const t1 = setTimeout(() => maybeFirePromo(userId), 20 * 1000);
    const t2 = setInterval(() => maybeFirePromo(userId), 10 * 60 * 1000);
    return () => { clearTimeout(t1); clearInterval(t2); };
  }, [userId]);

  useEffect(() => {
    if (!userId || !Array.isArray(sessions)) return;
    const firedKey = `${STORAGE_PREFIX}reminders.${userId}`;
    let fired = {};
    try { fired = JSON.parse(localStorage.getItem(firedKey) || '{}'); } catch {}
    function check() {
      const now = Date.now();
      let changed = false;
      for (const s of sessions) {
        if (!s?.id || !s.date || !s.time) continue;
        if (s.status === 'Cancelled' || s.status === 'Completed') continue;
        const when = new Date(`${s.date}T${s.time}`).getTime();
        if (Number.isNaN(when)) continue;
        const diffMin = (when - now) / 60000;
        if (diffMin <= 15 && diffMin > -1 && !fired[s.id]) {
          notify(userId, {
            category: 'reminder',
            title: 'Session starting soon',
            body: `${s.topic || 'Your session'} starts at ${s.time}. Get ready to join.`,
          });
          fired[s.id] = now;
          changed = true;
        }
      }
      if (changed) {
        try { localStorage.setItem(firedKey, JSON.stringify(fired)); } catch {}
      }
    }
    check();
    const i = setInterval(check, 30 * 1000);
    return () => clearInterval(i);
  }, [userId, sessions]);

  useEffect(() => {
    function onDoc(e) {
      if (!open) return;
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="notification-bell" ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="notification-bell-btn"
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        title={unread ? `${unread} new notification${unread === 1 ? '' : 's'}` : 'Notifications'}
        onClick={() => { setOpen((v) => !v); if (!open && unread) markAllRead(); }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="notification-bell-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notification-popover" role="dialog" aria-label="Notifications">
          <div className="notification-popover-head">
            <strong>Notifications</strong>
            <div className="notification-popover-actions">
              <button type="button" className="link-btn" onClick={markAllRead}>Mark all read</button>
              <button type="button" className="link-btn" onClick={clearAll}>Clear</button>
            </div>
          </div>
          <div className="notification-popover-list">
            {items.length === 0 && <div className="notification-empty">You’re all caught up.</div>}
            {items.map((n) => (
              <div key={n.id} className={`notification-item${n.read ? '' : ' unread'}`}>
                <span className="notification-icon" aria-hidden="true">{n.icon}</span>
                <div className="notification-body">
                  <div className="notification-title">{n.title}</div>
                  {n.body && <div className="notification-text">{n.body}</div>}
                  <div className="notification-meta">{timeAgo(n.createdAt)} • {n.category}</div>
                </div>
                <button type="button" className="notification-dismiss" aria-label="Dismiss" onClick={() => remove(n.id)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
