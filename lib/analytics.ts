import posthog from 'posthog-js';

export type PollCardSection = 'hero' | 'popular' | 'rising' | 'latest';
export type PollViewerState = 'unvoted' | 'voted';
export type VoteAction = 'initial' | 'change';
export type VoteResultSource = 'new_vote' | 'existing_vote';

type AnalyticsEventProperties = {
  poll_card_clicked: {
    poll_id: string;
    section: PollCardSection;
    category: string;
    position: number;
  };
  poll_viewed: {
    poll_id: string;
    category: string;
    participants: number;
    viewer_state: PollViewerState;
  };
  vote_submitted: {
    poll_id: string;
    category: string;
    option_index: number;
    vote_action: VoteAction;
  };
  vote_result_viewed: {
    poll_id: string;
    source: VoteResultSource;
  };
  next_poll_clicked: {
    from_poll_id: string;
    to_poll_id: string;
  };
  poll_created: {
    poll_id: string;
    category: string;
    option_count: number;
    image_count: number;
  };
};

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();

let analyticsInitialized = false;

function isLocalHostname(hostname: string) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname.endsWith('.localhost');
}

export function isAnalyticsEnabled() {
  return typeof window !== 'undefined'
    && process.env.NODE_ENV === 'production'
    && process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
    && !isLocalHostname(window.location.hostname)
    && Boolean(posthogToken && posthogHost);
}

export function initializeAnalytics() {
  if (analyticsInitialized || !isAnalyticsEnabled() || !posthogToken || !posthogHost) return;

  try {
    posthog.init(posthogToken, {
      api_host: posthogHost,
      autocapture: false,
      rageclick: false,
      capture_pageview: 'history_change',
      capture_pageleave: false,
      capture_performance: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_scroll_properties: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      person_profiles: 'never',
    });
    analyticsInitialized = true;
  } catch {
    analyticsInitialized = false;
  }
}

function trackEvent<EventName extends keyof AnalyticsEventProperties>(
  eventName: EventName,
  properties: AnalyticsEventProperties[EventName],
) {
  if (!analyticsInitialized) return;

  try {
    posthog.capture(eventName, properties);
  } catch {
    // Analytics is a non-critical side effect and must never block product flows.
  }
}

export function trackPollCardClicked(properties: AnalyticsEventProperties['poll_card_clicked']) {
  trackEvent('poll_card_clicked', properties);
}

export function trackPollViewed(properties: AnalyticsEventProperties['poll_viewed']) {
  trackEvent('poll_viewed', properties);
}

export function trackVoteSubmitted(properties: AnalyticsEventProperties['vote_submitted']) {
  trackEvent('vote_submitted', properties);
}

export function trackVoteResultViewed(properties: AnalyticsEventProperties['vote_result_viewed']) {
  trackEvent('vote_result_viewed', properties);
}

export function trackNextPollClicked(properties: AnalyticsEventProperties['next_poll_clicked']) {
  trackEvent('next_poll_clicked', properties);
}

export function trackPollCreated(properties: AnalyticsEventProperties['poll_created']) {
  trackEvent('poll_created', properties);
}
