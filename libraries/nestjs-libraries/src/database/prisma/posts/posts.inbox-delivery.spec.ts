import { decodeInboxHistory, inboxPostMaterial, type InboxPostSelection } from './posts.inbox-delivery';
const NOW = Date.UTC(2026, 9, 27, 14, 20);
const PUB = 'v_inbox_file~fixture';
const KEYS = ['postizPostId', 'channelId', 'mediaId', 'publishId', 'providerAccountId', 'status', 'source', 'checkedAt'].sort();
function post(): InboxPostSelection {
  return { id: 'postA', organizationId: 'orgA', integrationId: 'channelA', state: 'PUBLISHED',
    publishDate: new Date(NOW - 1000), updatedAt: new Date(NOW - 1000), intervalInDays: null,
    settings: JSON.stringify({ content_posting_method: 'UPLOAD', tiktokConsent: true }),
    image: JSON.stringify([{ id: 'mediaA', path: 'https://fixture.invalid/clip.mp4' }]),
    integration: { id: 'channelA', organizationId: 'orgA', internalId: 'accountA', providerIdentifier: 'tiktok', disabled: false, deletedAt: null, inBetweenSteps: false } };
}
function payload(value: unknown, bytes?: number) {
  const text = JSON.stringify(value);
  return { metadata: { encoding: Buffer.from('json/plain') }, data: Buffer.from(bytes ? text.padEnd(bytes, ' ') : text) };
}
function history(options: { publishId?: string; status?: string; delivery?: string; at?: number; noCheck?: boolean } = {}): any {
  const at = options.at ?? NOW - 1000;
  const native = { status: options.status ?? 'completed', deliveryStatus: options.delivery ?? 'inbox', postId: 'missing', releaseURL: 'https://www.tiktok.com/messages?lang=en' };
  const secret = {};
  Object.defineProperty(secret, 'data', { get() { throw new Error('SYNTHETIC_SECRET_MUST_NEVER_BE_READ'); } });
  return { events: [
    { eventId: 1, workflowExecutionStartedEventAttributes: { workflowType: { name: 'postWorkflowV112' }, input: { payloads: [payload({ taskQueue: 'main', postId: 'postA', organizationId: 'orgA' })] } } },
    { eventId: 2, activityTaskScheduledEventAttributes: { activityType: { name: 'postSocialPending' }, input: { payloads: [secret] } } },
    { eventId: 3, activityTaskCompletedEventAttributes: { scheduledEventId: 2, result: { payloads: [payload([{ id: 'postA', postId: 'missing', releaseURL: '', status: 'pending', pendingData: { publishId: PUB } }])] } } },
    ...options.noCheck ? [] : [
      { eventId: 4, activityTaskScheduledEventAttributes: { activityType: { name: 'checkPostStatus' }, input: { payloads: [secret, payload({ publishId: options.publishId ?? PUB })] } } },
      { eventId: 5, eventTime: { seconds: Math.floor(at / 1000), nanos: at % 1000 * 1e6 }, activityTaskCompletedEventAttributes: { scheduledEventId: 4, result: { payloads: [payload(native)] } } },
    ],
  ] };
}
function read(h: unknown, current = post()) {
  const before = JSON.stringify(current), result = decodeInboxHistory(current, 'mediaA', h, NOW);
  expect(JSON.stringify(current)).toBe(before); expect(Object.keys(result).sort()).toEqual(KEYS);
  expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC_SECRET|refresh|session|caption|password/);
  expect(result.source).toBe('tiktok_status'); return result;
}

test('inbox delivery read: P06 ATTRIBUTION', () => {
  expect(read(history({ publishId: 'foreign-native-id' })).status).toBe('UNKNOWN');
  const foreign = { ...post(), integration: { ...post().integration, id: 'foreign-channel', organizationId: 'foreign-org', internalId: 'foreign-account' } };
  expect(inboxPostMaterial(foreign, NOW)).toBeNull();
});

test('inbox delivery read: P07 TRUE INBOX', () => {
  expect(read(history())).toEqual({ postizPostId: 'postA', channelId: 'channelA', mediaId: 'mediaA', providerAccountId: 'accountA', publishId: PUB,
    status: 'SEND_TO_USER_INBOX', source: 'tiktok_status', checkedAt: new Date(NOW - 1000).toISOString() });
});

test('inbox delivery read: P08 FALSE SUCCESS', () => {
  for (const h of [history({ noCheck: true }), history({ delivery: 'published' })]) expect(read(h).status).toBe('UNKNOWN');
});

test('inbox delivery read: P09 NONFINAL', () => {
  for (const h of [history({ status: 'processing', delivery: 'processing-upload' }), history({ status: 'failed', delivery: 'failed' }), history({ noCheck: true })]) {
    expect(read(h).status).toBe('UNKNOWN');
  }
});

test('inbox delivery read: P10 TIME', () => {
  for (const at of [NOW - 300001, NOW + 1000]) {
    const result = read(history({ at })); expect(result.status).toBe('UNKNOWN'); expect(result.checkedAt).toBeNull();
  }
});

test('inbox delivery read: P11 BOUNDS', () => {
  // Exactly five fixed rows. Neutral events carry no payload and preserve order.
  for (const count of [500, 501]) {
    const h = history(); while (h.events.length < count) h.events.push({ eventId: h.events.length + 1 });
    expect(read(h).status).toBe(count === 500 ? 'SEND_TO_USER_INBOX' : 'UNKNOWN');
  }
  for (const size of [65536, 65537]) {
    const h = history(); h.events[0].workflowExecutionStartedEventAttributes.input.payloads[0] = payload({ taskQueue: 'main', postId: 'postA', organizationId: 'orgA' }, size);
    expect(read(h).status).toBe(size === 65536 ? 'SEND_TO_USER_INBOX' : 'UNKNOWN');
  }
  const h = history(); h.events[0].workflowExecutionStartedEventAttributes.input.payloads[0].metadata.encoding = Buffer.from('binary/plain');
  expect(read(h).status).toBe('UNKNOWN');
});
