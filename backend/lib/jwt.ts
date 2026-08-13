/**
 * JWT 工具：签发/校验/载荷类型。
 * 会话方式：JWT（Access Token），登出通过把 jti 写入黑名单实现即时失效。
 */
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

export interface AuthConfig {
  secret: string;
  /** 过期秒数，默认 7 天 */
  expiresInSeconds?: number;
}

function defaultConfig(): AuthConfig {
  return {
    secret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
    expiresInSeconds: Number(process.env.JWT_EXPIRES_IN_SECONDS) || 7 * 24 * 3600,
  };
}

export interface SignedToken {
  token: string;
  jti: string;
  expiresAt: Date; // 过期时间（用于黑名单条目）
}

export function signAuthToken(userId: string, phone: string, config: AuthConfig = defaultConfig()): SignedToken {
  const jti = randomUUID();
  const expiresIn = config.expiresInSeconds;
  const token = jwt.sign({ sub: userId, phone, jti } as AuthTokenPayload, config.secret, {
    expiresIn,
  });
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  return { token, jti, expiresAt };
}

export type VerifyResult =
  | { ok: true; payload: AuthTokenPayload }
  | { ok: false; reason: string };

export interface AuthTokenPayload {
  sub: string;      // user id
  phone: string;
  jti: string;      // 撤销黑名单 key
  exp?: number;     // 过期时间（epoch 秒），验证时回填
}

export function verifyAuthToken(token: string, config: AuthConfig = defaultConfig()): VerifyResult {
  try {
    const decoded = jwt.verify(token, config.secret) as jwt.JwtPayload & Partial<AuthTokenPayload>;
    if (typeof decoded.sub !== 'string' || typeof decoded.jti !== 'string' || typeof decoded.phone !== 'string') {
      return { ok: false, reason: 'invalid payload' };
    }
    return {
      ok: true,
      payload: { sub: decoded.sub, phone: decoded.phone, jti: decoded.jti, exp: typeof decoded.exp === 'number' ? decoded.exp : undefined },
    };
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
}
