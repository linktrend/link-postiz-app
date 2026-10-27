/** Credential-free result for the tenant-owned TikTok inbox read endpoint. */
export type PostInboxDelivery = Readonly<{
  postizPostId: string;
  channelId: string;
  mediaId: string;
  publishId: string | null;
  providerAccountId: string;
  status: 'SEND_TO_USER_INBOX' | 'FAILED' | 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'UNKNOWN';
  source: 'tiktok_status';
  checkedAt: string | null;
}>;

/** Only fields selected by the organization-scoped repository; no credential/content select. */
export type InboxPostSelection = Readonly<{
  id: string; organizationId: string; integrationId: string; state: string;
  publishDate: Date; updatedAt: Date; intervalInDays: number | null; settings: string | null; image: string | null;
  integration: Readonly<{ id: string; organizationId: string; internalId: string;
    providerIdentifier: string; disabled: boolean; deletedAt: Date | null; inBetweenSteps: boolean }>;
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PUBLISH_ID = /^[A-Za-z0-9._~:-]{1,256}$/;
const own = (value: unknown, key: string): unknown => value && typeof value === 'object'
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(k => allowed.includes(k));
function json(text: string): unknown {
  if (Buffer.byteLength(text) > 65_536) throw new Error('inbox_unavailable');
  return JSON.parse(text) as unknown;
}

/** Validate current provider/material policy without contacting the provider or inspecting tokens. */
export function inboxPostMaterial(post: InboxPostSelection, nowMs: number): Readonly<{ mediaId: string; path: string }> | null {
  try {
    if (!ID.test(post.id) || !ID.test(post.organizationId) || !ID.test(post.integrationId) ||
        post.integration.id !== post.integrationId || post.integration.organizationId !== post.organizationId ||
        post.integration.providerIdentifier !== 'tiktok' || post.integration.disabled || post.integration.deletedAt !== null || post.integration.inBetweenSteps ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(post.integration.internalId) ||
        !['QUEUE', 'PUBLISHED', 'ERROR'].includes(post.state) || post.intervalInDays !== null || !Number.isFinite(nowMs) ||
        !Number.isFinite(post.publishDate.getTime()) || post.publishDate.getTime() > nowMs || !post.settings || !post.image) return null;
    const settings = json(post.settings), media = json(post.image);
    if (!object(settings) || settings.content_posting_method !== 'UPLOAD' || settings.tiktokConsent !== true ||
        !Array.isArray(media) || media.length !== 1 || !object(media[0]) ||
        typeof media[0].id !== 'string' || !ID.test(media[0].id) || typeof media[0].path !== 'string' || media[0].path.length > 4096) return null;
    const path = new URL(media[0].path);
    if (!['http:', 'https:'].includes(path.protocol) || path.username || path.password || !path.pathname.toLowerCase().endsWith('.mp4')) return null;
    return Object.freeze({ mediaId: media[0].id, path: media[0].path });
  } catch { return null; }
}

function payload(value: unknown, remaining: { bytes: number }): unknown {
  const metadata = own(value, 'metadata'), data = own(value, 'data');
  const encoding = own(metadata, 'encoding');
  if (!(encoding instanceof Uint8Array) || Buffer.from(encoding).toString('utf8') !== 'json/plain' ||
      !(data instanceof Uint8Array) || data.byteLength > 65_536 || (remaining.bytes -= data.byteLength) < 0) throw new Error('inbox_unavailable');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as unknown;
}
function eventNumber(value: unknown): number {
  if (typeof value === 'number' || typeof value === 'string') {
    const n = Number(value); if (Number.isSafeInteger(n) && n >= 0) return n;
  }
  const low = own(value, 'low'), high = own(value, 'high');
  if (typeof low === 'number' && typeof high === 'number' && Number.isInteger(low) && Number.isInteger(high)) {
    const n = high * 4294967296 + (low >>> 0); if (Number.isSafeInteger(n) && n >= 0) return n;
  }
  throw new Error('inbox_unavailable');
}
function eventTime(event: unknown): number {
  const time = own(event, 'eventTime'), seconds = eventNumber(own(time, 'seconds'));
  const nanos = own(time, 'nanos') ?? 0;
  if (typeof nanos !== 'number' || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) throw new Error('inbox_unavailable');
  const ms = seconds * 1000 + Math.floor(nanos / 1e6);
  if (!Number.isSafeInteger(ms)) throw new Error('inbox_unavailable');
  return ms;
}

/** Decode at most one bounded history page. Never decode integration/session or refresh payloads. */
export function decodeInboxHistory(post: InboxPostSelection, mediaId: string, history: unknown, nowMs: number): PostInboxDelivery {
  const base: PostInboxDelivery = { postizPostId: post.id, channelId: post.integrationId, mediaId,
    providerAccountId: post.integration.internalId, publishId: null, checkedAt: null, status: 'UNKNOWN', source: 'tiktok_status' };
  try {
    const events = own(history, 'events');
    if (!Array.isArray(events) || events.length < 1 || events.length > 500) return Object.freeze(base);
    const remaining = { bytes: 1024 * 1024 };
    const scheduled = new Map<number, { name: string; publishId?: string }>();
    let started = false, nativePublishId: string | undefined, lastEvent = 0;
    let observation: { status: PostInboxDelivery['status']; publishId: string; at: number } | undefined;
    for (const event of events) {
      const id = eventNumber(own(event, 'eventId'));
      if (id <= lastEvent) throw new Error('inbox_unavailable'); lastEvent = id;
      const start = own(event, 'workflowExecutionStartedEventAttributes');
      if (start) {
        if (started || own(own(start, 'workflowType'), 'name') !== 'postWorkflowV112') throw new Error('inbox_unavailable');
        const inputs = own(own(start, 'input'), 'payloads');
        if (!Array.isArray(inputs) || inputs.length !== 1) throw new Error('inbox_unavailable');
        const request = payload(inputs[0], remaining);
        if (!object(request) || !keys(request, ['taskQueue', 'postId', 'organizationId']) || request.postId !== post.id || request.organizationId !== post.organizationId) throw new Error('inbox_unavailable');
        started = true;
      }
      const activity = own(event, 'activityTaskScheduledEventAttributes');
      if (activity) {
        const name = own(own(activity, 'activityType'), 'name');
        if (name === 'postSocialPending') scheduled.set(id, { name });
        if (name === 'checkPostStatus') {
          const inputs = own(own(activity, 'input'), 'payloads');
          // Payload0 is the credential-bearing Integration. Never access/decode it.
          if (!Array.isArray(inputs) || inputs.length !== 2) throw new Error('inbox_unavailable');
          const pending = payload(inputs[1], remaining);
          if (!object(pending) || !keys(pending, ['publishId']) || typeof pending.publishId !== 'string' || !PUBLISH_ID.test(pending.publishId)) throw new Error('inbox_unavailable');
          scheduled.set(id, { name, publishId: pending.publishId });
        }
      }
      const completed = own(event, 'activityTaskCompletedEventAttributes');
      if (!completed) continue;
      const source = scheduled.get(eventNumber(own(completed, 'scheduledEventId')));
      if (!source) continue;
      const results = own(own(completed, 'result'), 'payloads');
      if (!Array.isArray(results) || results.length !== 1) throw new Error('inbox_unavailable');
      const result = payload(results[0], remaining);
      if (source.name === 'postSocialPending') {
        if (!Array.isArray(result) || result.length !== 1 || !object(result[0]) ||
            !keys(result[0], ['id', 'releaseURL', 'postId', 'status', 'pendingData']) || result[0].id !== post.id || result[0].status !== 'pending') throw new Error('inbox_unavailable');
        const pending = result[0].pendingData;
        if (!object(pending) || !keys(pending, ['publishId']) || typeof pending.publishId !== 'string' || !PUBLISH_ID.test(pending.publishId) ||
            nativePublishId && nativePublishId !== pending.publishId) throw new Error('inbox_unavailable');
        nativePublishId = pending.publishId;
      } else {
        if (!nativePublishId || source.publishId !== nativePublishId || !object(result) ||
            !keys(result, ['status', 'pendingData', 'postId', 'releaseURL', 'deliveryStatus'])) throw new Error('inbox_unavailable');
        const inbox = result.status === 'completed' && result.deliveryStatus === 'inbox' && result.postId === 'missing' &&
          result.releaseURL === 'https://www.tiktok.com/messages?lang=en' && post.state === 'PUBLISHED';
        observation = { status: inbox ? 'SEND_TO_USER_INBOX' : 'UNKNOWN', publishId: nativePublishId, at: eventTime(event) };
      }
    }
    if (!started || !observation || !Number.isFinite(nowMs) || observation.at > nowMs || nowMs - observation.at > 300_000) return Object.freeze(base);
    return Object.freeze({ ...base, status: observation.status, publishId: observation.publishId, checkedAt: new Date(observation.at).toISOString() });
  } catch { return Object.freeze(base); }
}
