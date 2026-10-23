import { GA_MEASUREMENT_ID } from './analytics-config.js';

const CANONICAL_PAGE = Object.freeze({
  page_location: 'https://hammerlee.ai/',
  page_referrer: '',
  page_title: '川伯，聊聊｜3D 市政資訊互動展示',
});
const EVENT_NAMES = new Set(['journey_complete', 'share', 'download']);
const MEASUREMENT_ID = /^G-[A-Z0-9]{6,20}$/;

// Never inspect href/search/hash: share links contain a private journey identifier.
export function isProductionLocation(location) {
  return Boolean(location && location.protocol === 'https:' &&
    location.hostname === 'hammerlee.ai' && (!location.port || location.port === '443'));
}

function hasPrivacyPreference(host) {
  return host.navigator?.globalPrivacyControl === true ||
    ['1', 'yes'].includes(host.navigator?.doNotTrack) || host.doNotTrack === '1';
}

/**
 * Minimal GA4 adapter. The GA stream must have Enhanced Measurement disabled:
 * its search/history/link events can otherwise read journey URLs independently.
 * Google documentation: developers.google.com/analytics/devguides/collection/ga4/views
 * and developers.google.com/analytics/devguides/collection/ga4/reference/config
 *
 * Events intentionally accept no parameter object. Never add journey IDs, dialogue,
 * visitor responses, user properties, or inferred political interests here.
 */
export function createAnalyticsClient(host = globalThis.window) {
  let measurementId = '';
  let phase = 'idle';
  let reason = '';
  let enqueue;

  function getState() {
    return { phase, reason, measurementId, enabled: ['scheduled', 'loading', 'ready'].includes(phase) };
  }

  function initAnalytics(id = GA_MEASUREMENT_ID) {
    if (measurementId) return measurementId === id && getState().enabled;
    if (typeof id !== 'string' || !MEASUREMENT_ID.test(id)) {
      phase = 'disabled'; reason = id ? 'invalid-id' : 'unconfigured'; return false;
    }
    if (!host?.document?.createElement || !host.document.head) {
      phase = 'disabled'; reason = 'unsupported'; return false;
    }
    if (!isProductionLocation(host.location)) {
      phase = 'disabled'; reason = 'non-production'; return false;
    }
    if (hasPrivacyPreference(host)) {
      phase = 'disabled'; reason = 'privacy-preference'; return false;
    }

    measurementId = id;
    phase = 'scheduled'; reason = '';
    host.dataLayer = host.dataLayer || [];
    // Match Google's queue format without exposing a general-purpose tracking API.
    enqueue = function () { host.dataLayer.push(arguments); };
    // Advertising stays denied. This does not claim that visitors gave consent.
    enqueue('consent', 'default', {
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    });
    enqueue('set', {
      ...CANONICAL_PAGE,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ignore_referrer: true,
    });
    enqueue('js', new Date());
    enqueue('config', measurementId, {
      ...CANONICAL_PAGE,
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ignore_referrer: true,
      cookie_flags: 'SameSite=Lax;Secure',
    });
    // Exactly one page view from this adapter, with no history/scroll listeners.
    enqueue('event', 'page_view', { ...CANONICAL_PAGE, send_to: measurementId });

    const load = () => {
      if (phase !== 'scheduled') return;
      try {
        const script = host.document.createElement('script');
        script.async = true;
        script.referrerPolicy = 'no-referrer';
        script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
        script.onload = () => { phase = 'ready'; };
        script.onerror = () => { phase = 'failed'; reason = 'script-unavailable'; };
        phase = 'loading';
        host.document.head.appendChild(script);
      } catch {
        phase = 'failed'; reason = 'script-unavailable';
      }
    };
    // Keep the 3D interface's first render ahead of this optional network request.
    if (typeof host.requestIdleCallback === 'function') {
      host.requestIdleCallback(load, { timeout: 2000 });
    } else {
      host.setTimeout(load, 1200);
    }
    return true;
  }

  function trackEvent(name) {
    if (!EVENT_NAMES.has(name) || !getState().enabled || hasPrivacyPreference(host)) return false;
    enqueue('event', name, { ...CANONICAL_PAGE, send_to: measurementId });
    return true;
  }

  return { initAnalytics, trackEvent, getState };
}

let client;
function getClient() { return client ||= createAnalyticsClient(); }

export function initAnalytics(id = GA_MEASUREMENT_ID) { return getClient().initAnalytics(id); }
export function trackEvent(name) { return getClient().trackEvent(name); }
export function getAnalyticsState() { return getClient().getState(); }
