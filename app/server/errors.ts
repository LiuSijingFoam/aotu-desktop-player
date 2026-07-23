export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly operational = true,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UpstreamError extends AppError {
  constructor(
    status: number,
    code: string,
    message: string,
    readonly upstreamStatus?: number,
  ) {
    super(status, code, message);
    this.name = "UpstreamError";
  }
}

export function routeError(error: unknown, requestId: string) {
  if (error instanceof AppError && error.operational) {
    return Response.json(
      {
        code: error.code,
        message: error.message,
        requestId,
      },
      {
        status: error.status,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  }

  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandled_route_error",
      requestId,
      error: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );

  return Response.json(
    {
      code: "INTERNAL_ERROR",
      message: "服务暂时不可用，请稍后再试。",
      requestId,
    },
    {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

export async function withRoute(
  handler: (requestId: string) => Promise<Response>,
) {
  const requestId = crypto.randomUUID();
  try {
    const response = await handler(requestId);
    response.headers.set("X-Request-Id", requestId);
    return response;
  } catch (error) {
    return routeError(error, requestId);
  }
}
