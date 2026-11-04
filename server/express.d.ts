declare global {
  namespace Express {
    interface Request {
      accountId?: number;
    }
  }
}

export {};
