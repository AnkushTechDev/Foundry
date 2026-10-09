import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from "@nestjs/common";
import { AppError, isAppError } from "@foundry/shared";
import type { Response } from "express";
import { Observable, map } from "rxjs";
import { ZodError } from "zod";

export const RAW_RESPONSE = "raw_response";
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);
export const PROJECT_ROLE = "project_role";

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = Reflect.getMetadata(RAW_RESPONSE, context.getHandler()) === true;
    if (raw) return next.handle();
    return next.handle().pipe(map((data) => ({ success: true, data: data ?? null })));
  }
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<{ id?: string; method?: string; url?: string }>();
    let status = 500;
    let code = "INTERNAL";
    let message = "Something went wrong";
    let details: unknown;
    if (isAppError(exception)) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      status = 400;
      code = "VALIDATION_FAILED";
      message = "Invalid input";
      details = exception.flatten();
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 429 ? "RATE_LIMITED" : "HTTP_ERROR";
      const body = exception.getResponse();
      message = typeof body === "string" ? body : (body as { message?: string }).message ?? message;
      if (Array.isArray(message)) message = message.join(", ");
    } else if (typeof exception === "object" && exception && "code" in exception && (exception as { code?: number }).code === 11000) {
      status = 409;
      code = "CONFLICT";
      message = "That value already exists";
    } else if (exception instanceof Error && process.env.NODE_ENV !== "production") {
      message = exception.message;
    }
    if (status >= 500) {
      const reason = exception instanceof Error ? exception.message : "unknown";
      console.error(JSON.stringify({ level: "error", requestId: request.id, method: request.method, url: request.url, reason }));
    }
    response.status(status).json({
      success: false,
      error: { code, message, details, requestId: request.id },
    });
  }
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new AppError("NOT_FOUND", message, 404);
  return value;
}
