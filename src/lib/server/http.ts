import "server-only";
import { z } from "zod";
import { type Role, type Session, authorizeRequest } from "./dal";
import { AppError, ForbiddenError, InternalError, toAppError, ValidationError } from "./errors";
import { type IdempotencyContext, buildIdempotencyContext } from "./idempotency";
import { logger } from "./logger";
import { RATE_LIMITS, type RateLimitScope, checkRateLimit } from "./ratelimit";

export type { Role, Session };
export type HandlerSession = Session;

export interface HandlerConfig<S extends z.ZodType | undefined> {
  schema?: S;
  role?: Role;
  rateLimit?: RateLimitScope;
  idempotent?: boolean;
}

export type HandlerInput<S> = S extends z.ZodType ? z.infer<S> : undefined;

export interface HandlerContext<TInput, TParams> {
  input: TInput;
  params: TParams;
  session: HandlerSession | null;
  requestId: string;
  request: Request;
  idempotency?: IdempotencyContext;
}

export type HandlerResult = Response | Record<string, unknown> | null | void;

export type HandlerFn<TInput, TParams> = (
  ctx: HandlerContext<TInput, TParams>,
) => Promise<HandlerResult> | HandlerResult;

type RouteContext<TParams> = { params: Promise<TParams> } | undefined;

function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function requestHost(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) return forwarded;
  const host = request.headers.get("host");
  if (host) return host;
  try {
    return new URL(request.url).host;
  } catch {
    return null;
  }
}

function assertSameOrigin(request: Request): void {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ForbiddenError("Cross-site request rejected.");
  }
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Invalid Origin header.");
  }
  if (originHost !== requestHost(request)) {
    throw new ForbiddenError("Cross-origin request rejected.");
  }
}

async function parseInput(request: Request, schema: z.ZodType | undefined): Promise<unknown> {
  if (!schema) return undefined;
  let raw: unknown;
  if (isMutation(request.method)) {
    try {
      raw = await request.json();
    } catch {
      throw new ValidationError("Request body must be valid JSON.");
    }
  } else {
    raw = Object.fromEntries(new URL(request.url).searchParams);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw ValidationError.fromZod(parsed.error);
  return parsed.data;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function enforceRateLimit(
  scope: RateLimitScope | undefined,
  session: Session | null,
  request: Request,
): Promise<void> {
  if (!scope) return;
  const key = RATE_LIMITS[scope].key === "uid" ? session?.uid : clientIp(request);
  if (!key) throw new InternalError();
  await checkRateLimit(scope, key);
}

function toResponse(result: HandlerResult): Response {
  if (result instanceof Response) return result;
  if (result === null || result === undefined) return new Response(null, { status: 204 });
  return Response.json(result);
}

export function defineHandler<
  S extends z.ZodType | undefined = undefined,
  TParams = Record<string, string>,
>(config: HandlerConfig<S>, fn: HandlerFn<HandlerInput<S>, TParams>) {
  return async function handler(
    request: Request,
    routeContext?: RouteContext<TParams>,
  ): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    const route = (() => {
      try {
        return new URL(request.url).pathname;
      } catch {
        return request.url;
      }
    })();
    let actorUid: string | undefined;

    try {
      if (isMutation(request.method)) assertSameOrigin(request);

      const params = (routeContext ? await routeContext.params : ({} as TParams)) as TParams;
      const boothId = (params as Record<string, unknown>)?.boothId;

      const session = await authorizeRequest(
        config.role ?? "public",
        request,
        typeof boothId === "string" ? boothId : undefined,
      );
      actorUid = session?.uid;

      await enforceRateLimit(config.rateLimit, session, request);

      const input = (await parseInput(request, config.schema)) as HandlerInput<S>;

      let idempotency: IdempotencyContext | undefined;
      if (config.idempotent) {
        if (!session) throw new InternalError();
        idempotency = buildIdempotencyContext({
          request,
          actorUid: session.uid,
          endpoint: route,
          body: input,
        });
      }

      const result = await fn({ input, params, session, requestId, request, idempotency });
      const response = toResponse(result);
      response.headers.set("x-request-id", requestId);

      logger.info({
        event: "request",
        requestId,
        route,
        actorUid,
        latencyMs: Math.round(performance.now() - startedAt),
      });
      return response;
    } catch (err) {
      const appError = toAppError(err);
      const isInternal = appError instanceof InternalError;
      const headers = new Headers(appError.headers());
      headers.set("x-request-id", requestId);
      const response = Response.json(appError.toEnvelope(requestId), {
        status: appError.status,
        headers,
      });

      logger[isInternal ? "error" : "warn"]({
        event: "request",
        requestId,
        route,
        actorUid,
        latencyMs: Math.round(performance.now() - startedAt),
        code: appError.code,
        err: isInternal && err instanceof AppError === false ? err : undefined,
      });
      return response;
    }
  };
}
