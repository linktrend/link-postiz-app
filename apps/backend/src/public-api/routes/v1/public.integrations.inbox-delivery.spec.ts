import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import * as ts from 'typescript';
import * as common from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { decodeInboxHistory, inboxPostMaterial } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.inbox-delivery';

// Evaluate the real class bodies with explicit synthetic dependency seams. No
// production module graph, storage factory, Prisma client or application starts.
const ROOT = process.cwd();
const neverCall = () => { throw new Error('unapproved dependency call'); };
const noopDecorator = () => () => undefined;
const fallback = new Proxy({}, { get: (_target, key) => key === '__esModule' ? true :
  new Proxy(neverCall, { get: () => neverCall }) });
function sourceClass(path: string, extras: Record<string, unknown> = {}) {
  const output = ts.transpileModule(readFileSync(resolve(ROOT, path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true, emitDecoratorMetadata: false, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} as any };
  const deps: Record<string, unknown> = {
    '@nestjs/common': common,
    '@nestjs/swagger': { ApiTags: noopDecorator },
    '@nestjs/platform-express': { FileInterceptor: () => class SyntheticInterceptor {} },
    '@gitroom/nestjs-libraries/upload/multer.stream.engine': { streamUploadOptions: () => ({}) },
    '@gitroom/nestjs-libraries/user/org.from.request': { GetOrgFromRequest: noopDecorator },
    '@gitroom/nestjs-libraries/user/include.deleted.from.request': { GetIncludeDeletedFromRequest: noopDecorator },
    '@gitroom/backend/services/auth/permissions/permissions.ability': { CheckPolicies: noopDecorator },
    '@gitroom/nestjs-libraries/services/exception.filter': { HttpForbiddenException: common.ForbiddenException },
    '@gitroom/nestjs-libraries/sentry/initialize.sentry': { setSentryUserContext: () => undefined },
    './posts.inbox-delivery': { decodeInboxHistory, inboxPostMaterial },
    'dayjs': require('dayjs'), 'dayjs/plugin/utc': require('dayjs/plugin/utc'),
    'dayjs/plugin/isoWeek': require('dayjs/plugin/isoWeek'),
    'dayjs/plugin/weekOfYear': require('dayjs/plugin/weekOfYear'),
    'dayjs/plugin/isSameOrAfter': require('dayjs/plugin/isSameOrAfter'),
    ...extras,
  };
  new Function('require', 'exports', 'module', output)((name: string) => deps[name] ?? fallback, module.exports, module);
  return module.exports;
}
const C = sourceClass('apps/backend/src/public-api/routes/v1/public.integrations.controller.ts').PublicIntegrationsController;
const A = sourceClass('apps/backend/src/services/auth/public.auth.middleware.ts').PublicAuthMiddleware;
const S = sourceClass('libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts').PostsService;
const R = sourceClass('libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts').PostsRepository;
const M = sourceClass('apps/backend/src/public-api/public.api.module.ts', {
  '@gitroom/backend/public-api/routes/v1/public.integrations.controller': { PublicIntegrationsController: C },
  '@gitroom/backend/services/auth/public.auth.middleware': { PublicAuthMiddleware: A },
}).PublicApiModule;
const path = '/posts/:id/inbox-delivery';
const method = C.prototype.getInboxDelivery;
const canary = 'SYNTHETIC_CREDENTIAL_CANARY';
const guards: jest.SpyInstance[] = [];
beforeAll(() => {
  for (const [name, methods] of [['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
    ['node:net', ['connect', 'createConnection']], ['node:child_process', ['spawn', 'exec', 'execFile']]] as const) {
    const mod = require(name); for (const key of methods) guards.push(jest.spyOn(mod, key).mockImplementation(neverCall));
  }
  guards.push(jest.spyOn(globalThis, 'fetch').mockImplementation(neverCall));
});
afterAll(() => guards.forEach(spy => spy.mockRestore()));
afterEach(() => { for (const spy of guards) expect(spy).not.toHaveBeenCalled(); });
function request(headers: Record<string, string> = {}) { return Object.assign(new EventEmitter(), { headers, authOrgId: 'orgA', includeDeleted: false, aborted: false }); }
function response() { const res: any = new EventEmitter(); res.destroyed = false; res.setHeader = jest.fn(); res.status = jest.fn(() => res); res.json = jest.fn(() => res); return res; }
function fixture() {
  return { id: 'postA', organizationId: 'orgA', integrationId: 'channelA', state: 'PUBLISHED',
    publishDate: new Date(Date.now() - 1000), updatedAt: new Date(0), intervalInDays: null,
    settings: JSON.stringify({ content_posting_method: 'UPLOAD', tiktokConsent: true }),
    image: JSON.stringify([{ id: 'mediaA', path: 'https://fixture.invalid/clip.mp4' }]),
    integration: { id: 'channelA', organizationId: 'orgA', internalId: 'accountA', providerIdentifier: 'tiktok', disabled: false, deletedAt: null, inBetweenSteps: false } };
}
function service(post: any = fixture()) {
  const history = jest.fn(async () => ({ history: { events: [] } }));
  const raw = { connection: { withAbortSignal: jest.fn(async (_signal, fn) => fn()) },
    withDeadline: jest.fn(async (_deadline, fn) => fn()), options: { namespace: 'synthetic' },
    workflow: { getHandle: jest.fn(() => ({ describe: jest.fn(async () => ({ runId: 'runA' })) })) },
    workflowService: { getWorkflowExecutionHistory: history } };
  const writes = jest.fn(neverCall);
  const repo: any = new Proxy({ getInboxDeliveryPost: jest.fn(async () => post), getInboxDeliveryMedia: jest.fn(async () => ({ id: 'mediaA', path: 'https://fixture.invalid/clip.mp4', updatedAt: new Date(0) })) },
    { get: (target, key) => key in target ? target[key] : writes });
  const instance = Object.assign(Object.create(S.prototype), { _postRepository: repo,
    _temporalService: { client: { getRawClient: () => raw } } });
  return { instance, repo, raw, history, writes };
}
function noSecrets(value: unknown) { expect(JSON.stringify(value)).not.toContain(canary); }

test('inbox delivery read: P01 AUTH', async () => {
  for (const header of [undefined, 'invalid-synthetic-key']) {
    const org = { getOrgByApiKey: jest.fn(async () => null) };
    const auth = new A(org, { getOrgByOAuthToken: neverCall });
    const req: any = request(header ? { authorization: header } : {}), res = response(), next = jest.fn();
    await auth.use(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
    expect(org.getOrgByApiKey).toHaveBeenCalledTimes(header ? 1 : 0); noSecrets(res.json.mock.calls);
  }
  const apply = jest.fn(() => ({ forRoutes: jest.fn() }));
  const routes = jest.fn(); apply.mockReturnValue({ forRoutes: routes });
  new M().configure({ apply }); expect(apply).toHaveBeenCalledWith(A); expect(routes).toHaveBeenCalledWith(C);
});

test('inbox delivery read: P02 ROUTE', async () => {
  const post = fixture(), f = service(post), before = JSON.stringify(post);
  const org = { id: 'orgA', subscription: {} }, req: any = request({ authorization: 'synthetic-A' }), res = response();
  await new A({ getOrgByApiKey: async () => org }, {}).use(req, res, jest.fn());
  const c = Object.assign(Object.create(C.prototype), { _postsService: f.instance });
  const result = await c.getInboxDelivery(req.org, 'postA', {}, req, res);
  expect(f.repo.getInboxDeliveryPost).toHaveBeenCalledWith('postA', 'orgA');
  expect(result.status).toBe('UNKNOWN'); expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(f.raw.workflow.getHandle).toHaveBeenCalledWith('post_postA');
  expect(f.history).toHaveBeenCalledWith({ namespace: 'synthetic', execution: { workflowId: 'post_postA', runId: 'runA' }, maximumPageSize: 501, waitNewEvent: false, skipArchival: true });
  for (const query of [{ tenant: 'orgB' }, { workflow: 'foreign' }]) {
    await expect(c.getInboxDelivery(org, 'postA', query, req, res)).rejects.toMatchObject({ status: 400 });
  }
  for (const verb of [common.RequestMethod.POST, common.RequestMethod.PUT, common.RequestMethod.DELETE]) {
    const handlers = Object.getOwnPropertyNames(C.prototype).filter(name => {
      const fn = C.prototype[name]; return typeof fn === 'function' && Reflect.getMetadata(PATH_METADATA, fn) === path && Reflect.getMetadata(METHOD_METADATA, fn) === verb;
    }); expect(handlers).toEqual([]);
  }
  expect(Reflect.getMetadata(PATH_METADATA, C)).toBe('/public/v1');
  expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(path); expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(common.RequestMethod.GET);
  expect(JSON.stringify(post)).toBe(before); expect(f.writes).not.toHaveBeenCalled(); noSecrets(result);
});

test('inbox delivery read: P03 ISOLATION', async () => {
  const findFirst = jest.fn(async () => null), r = Object.assign(Object.create(R.prototype), { _post: { model: { post: { findFirst } } } });
  const f = service(null); f.repo.getInboxDeliveryPost.mockImplementation(r.getInboxDeliveryPost.bind(r));
  await expect(f.instance.getInboxDelivery('orgB', 'postA', new AbortController().signal)).rejects.toMatchObject({ status: 404, message: 'Post not found' });
  expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'postA', organizationId: 'orgB', deletedAt: null, parentPostId: null });
  expect(f.history).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled(); noSecrets(findFirst.mock.calls);
});

test('inbox delivery read: P04 PROVIDER/POLICY', async () => {
  for (const kind of ['non-tiktok', 'DIRECT_POST', 'scheduled']) {
    const post = fixture();
    if (kind === 'non-tiktok') post.integration.providerIdentifier = 'x';
    if (kind === 'DIRECT_POST') post.settings = JSON.stringify({ content_posting_method: 'DIRECT_POST', tiktokConsent: true });
    if (kind === 'scheduled') post.publishDate = new Date(Date.now() + 60000);
    const before = JSON.stringify(post), f = service(post);
    await expect(f.instance.getInboxDelivery('orgA', 'postA', new AbortController().signal)).rejects.toMatchObject({ status: 400 });
    expect(f.history).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled(); expect(JSON.stringify(post)).toBe(before);
  }
});

test('inbox delivery read: P05 MATERIAL', async () => {
  for (const kind of ['consent-absent', 'ambiguous-mp4']) {
    const post = fixture();
    if (kind === 'consent-absent') post.settings = JSON.stringify({ content_posting_method: 'UPLOAD' });
    else post.image = JSON.stringify([{ id: 'mediaA', path: 'https://fixture.invalid/a.mp4' }, { id: 'mediaB', path: 'https://fixture.invalid/b.mp4' }]);
    const f = service(post); await expect(f.instance.getInboxDelivery('orgA', 'postA', new AbortController().signal)).rejects.toMatchObject({ status: 400 });
    expect(f.history).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
  }
  const postSelect = jest.fn(), mediaSelect = jest.fn();
  const r = Object.assign(Object.create(R.prototype), { _post: { model: { post: { findFirst: postSelect }, media: { findFirst: mediaSelect } } } });
  r.getInboxDeliveryPost('postA', 'orgA'); r.getInboxDeliveryMedia('mediaA', 'orgA');
  const serialized = JSON.stringify([postSelect.mock.calls, mediaSelect.mock.calls]);
  expect(serialized).not.toMatch(/token|refresh|caption|content|session|password/i);
  expect(mediaSelect.mock.calls[0][0]).toEqual({ where: { id: 'mediaA', organizationId: 'orgA', deletedAt: null, status: 'ready' }, select: { id: true, path: true, updatedAt: true } });
});

test('inbox delivery read: P12 FAILSAFE/SECRETS', async () => {
  const f = service(); const req: any = request(), res = response();
  const c = Object.assign(Object.create(C.prototype), { _postsService: f.instance });
  f.raw.connection.withAbortSignal.mockImplementation(async (signal, fn) => { signal.addEventListener('abort', () => undefined, { once: true }); return fn(); });
  f.history.mockImplementation(async () => { req.emit('aborted'); throw new Error(canary); });
  const started = Date.now();
  await expect(c.getInboxDelivery({ id: 'orgA' }, 'postA', {}, req, res)).rejects.toMatchObject({ status: 503, message: 'Inbox delivery is unavailable' });
  expect(Date.now() - started).toBeLessThan(4000); expect(f.raw.connection.withAbortSignal.mock.calls[0][0].aborted).toBe(true);
  expect(req.listenerCount('aborted')).toBe(0); expect(res.listenerCount('close')).toBe(0); expect(f.writes).not.toHaveBeenCalled();
  let secretReads = 0;
  const poison: any = {}; Object.defineProperty(poison, 'data', { get() { secretReads++; throw new Error(canary); } });
  const events = [{ eventId: 1, activityTaskScheduledEventAttributes: { activityType: { name: 'unrelatedRefresh' }, input: { payloads: [poison] } } }];
  const result = decodeInboxHistory(fixture(), 'mediaA', { events }, Date.now());
  expect(secretReads).toBe(0); expect(result.status).toBe('UNKNOWN'); noSecrets(result);
  expect(Object.keys(result).sort()).toEqual(['postizPostId', 'channelId', 'mediaId', 'publishId', 'providerAccountId', 'status', 'source', 'checkedAt'].sort());
});
