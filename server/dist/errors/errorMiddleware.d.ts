import type { NextFunction, Request, Response } from 'express';
export declare const errorMiddleware: (error: unknown, _request: Request, response: Response, next: NextFunction) => void;
