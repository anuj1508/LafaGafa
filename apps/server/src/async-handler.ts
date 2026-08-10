import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not await handlers, so a rejected promise becomes an unhandled rejection and the
 * client hangs until it times out. Every async route goes through this.
 */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}
