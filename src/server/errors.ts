import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}

export function success<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.output<T>> {
  const text = await request.text();
  if (text.length > 16_384) fail(400, "BODY_TOO_LARGE", "Please send a smaller request.");
  try {
    return schema.parse(JSON.parse(text || "{}"));
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    fail(400, "INVALID_JSON", "The request must contain valid JSON.");
  }
}

export function errorResponse(error: unknown) {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Something went wrong. Please try again.";
  let fieldErrors: Record<string, string[] | undefined> | undefined;
  let retryAfterSeconds: number | undefined;
  if (error instanceof ApiError) {
    ({ status, code, message, retryAfterSeconds } = error);
  } else if (error instanceof z.ZodError) {
    status = 400;
    code = "INVALID_INPUT";
    message = error.issues[0]?.message ?? "Please check your update and try again.";
    fieldErrors = error.flatten().fieldErrors;
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      status = 409;
      code = "CONFLICT";
      message = "This action has already been completed. Refresh and try again.";
    } else if (error.code === "P2025") {
      status = 404;
      code = "NOT_FOUND";
      message = "This item is no longer available.";
    } else if (error.code === "P2034") {
      status = 409;
      code = "CONCURRENT_UPDATE";
      message = "Something changed. Please try again.";
    }
  }
  if (status === 500)
    console.error(
      JSON.stringify({
        event: "request_error",
        name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  return NextResponse.json(
    { error: { code, message, fieldErrors, retryAfterSeconds } },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {}),
      },
    },
  );
}
