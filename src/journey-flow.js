import { normalizeSeed, VERSION } from './conversation.js';

/** Match the public Worker's v/version aliases and original unversioned links. */
export function parseJourneyLink(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const seeds = params.getAll('s');
  if (!seeds.length) return { seed: null, version: VERSION };
  if (seeds.length !== 1) return null;
  const seed = normalizeSeed(seeds[0]);
  const versions = params.getAll('version'), aliases = params.getAll('v');
  if (!seed || versions.length > 1 || aliases.length > 1 ||
    (versions.length && aliases.length && versions[0] !== aliases[0])) return null;
  const value = versions[0] ?? aliases[0];
  const version = value === undefined ? 1 : value === '1' || value === '2' ? Number(value) : null;
  return version ? { seed, version } : null;
}

/** Leave room to continue scrolling without showing an entire empty phone screen. */
export function pendingRunwayHeight(remainingHeight, viewportHeight) {
  return Math.max(0, Math.min(remainingHeight, Math.max(160, Math.min(240, viewportHeight * .28))));
}

/**
 * Each restart gets its own save state and operation token. Old requests may
 * finish, but cannot clear a new request, change its status, or launch its share.
 */
export function createJourneyFlow({ conversation, save, share, onSaveState = () => {} }) {
  const makeSession = value => ({ conversation: value, saved: false, pending: null, shareToken: null });
  let active = makeSession(conversation);

  function report(session, status, error) {
    if (session === active) onSaveState({ status, error });
  }

  function persistSession(session) {
    if (session.saved) return Promise.resolve(true);
    if (session.pending) return session.pending;
    report(session, 'saving');
    const pending = Promise.resolve().then(() => save(session.conversation)).then(() => {
      session.saved = true;
      report(session, 'saved');
      return true;
    }).catch(error => {
      report(session, 'failed', error);
      return false;
    }).finally(() => {
      if (session.pending === pending) session.pending = null;
    });
    session.pending = pending;
    return pending;
  }

  return {
    reset(nextConversation) {
      active = makeSession(nextConversation);
      report(active, 'idle');
    },
    persist() { return persistSession(active); },
    async share(url) {
      const session = active;
      if (session.shareToken) return { method: 'busy' };
      const token = {};
      session.shareToken = token;
      const snapshot = { conversation: session.conversation, url: String(url) };
      try {
        await persistSession(session);
        if (session !== active || session.shareToken !== token) return { method: 'cancelled' };
        const result = await share(snapshot);
        return session === active && session.shareToken === token ? result : { method: 'cancelled' };
      } finally {
        if (session.shareToken === token) session.shareToken = null;
      }
    },
  };
}
