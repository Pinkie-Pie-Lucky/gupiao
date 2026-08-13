/**
 * 认证服务：注册 / 登录 / 登出 / 当前用户 / 改昵称。
 * 依赖 UserRepo + BlacklistRepo + 密码工具 + JWT，均为接口注入，便于测试与 PG/内存实现切换。
 */
import { randomUUID } from 'node:crypto';
import type { UserRepo, BlacklistRepo, UserRecord, PublicUser } from './db/repositories.js';
import { toPublicUser } from './db/repositories.js';
import { hashPassword, verifyPassword } from './password.js';
import { signAuthToken, verifyAuthToken, type AuthConfig, type AuthTokenPayload } from './jwt.js';
import { ApiError } from './errors.js';

export const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface AuthServiceDeps {
  users: UserRepo;
  blacklist: BlacklistRepo;
  jwtConfig?: AuthConfig;
}

function assertNickname(nickname: unknown): string {
  const value = String(nickname ?? '').trim();
  if (value.length < 2 || value.length > 16) throw new ApiError('昵称长度为 2–16 个字符。');
  return value;
}

function assertPassword(password: unknown): string {
  const value = String(password ?? '');
  if (value.length < 6 || value.length > 72) throw new ApiError('密码长度为 6–72 个字符。');
  return value;
}

function assertPhone(phone: unknown): string {
  const value = String(phone ?? '').trim();
  if (!PHONE_PATTERN.test(value)) throw new ApiError('请输入正确的 11 位手机号。');
  return value;
}

export class AuthService {
  private users: UserRepo;
  private blacklist: BlacklistRepo;
  private jwtConfig: AuthConfig;

  constructor(deps: AuthServiceDeps) {
    this.users = deps.users;
    this.blacklist = deps.blacklist;
    this.jwtConfig = deps.jwtConfig ?? {
      secret: process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
      expiresInSeconds: Number(process.env.JWT_EXPIRES_IN_SECONDS) || 7 * 24 * 3600,
    };
  }

  async register(phone: unknown, nickname: unknown, password: unknown): Promise<AuthResult> {
    const phoneValue = assertPhone(phone);
    const nicknameValue = assertNickname(nickname);
    const passwordValue = assertPassword(password);

    const existing = await this.users.findByPhone(phoneValue);
    if (existing) throw new ApiError('该手机号已注册，请直接登录。', 409);

    const user: UserRecord = {
      id: randomUUID(),
      phone: phoneValue,
      passwordHash: await hashPassword(passwordValue),
      nickname: nicknameValue,
      createdAt: new Date().toISOString(),
    };
    await this.users.create(user);

    const signed = signAuthToken(user.id, user.phone, this.jwtConfig);
    return { token: signed.token, user: toPublicUser(user) };
  }

  async login(phone: unknown, password: unknown): Promise<AuthResult> {
    const phoneValue = assertPhone(phone);
    const passwordValue = assertPassword(password);

    const user = await this.users.findByPhone(phoneValue);
    // 用户不存在也走一次假校验，避免通过耗时差异枚举手机号是否注册
    const ok = user ? await verifyPassword(passwordValue, user.passwordHash) : await verifyPassword(passwordValue, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalid');
    if (!user || !ok) throw new ApiError('手机号或密码不正确。', 401);

    const signed = signAuthToken(user.id, user.phone, this.jwtConfig);
    return { token: signed.token, user: toPublicUser(user) };
  }

  /** 登出：把当前 token 的 jti 写入黑名单，使其在剩余有效期内即时失效 */
  async logout(payload: AuthTokenPayload): Promise<void> {
    const remainingMs = payload.exp ? Math.max(0, payload.exp * 1000 - Date.now()) : 24 * 3600 * 1000;
    await this.blacklist.add({
      jti: payload.jti,
      userId: payload.sub,
      expiresAt: new Date(Date.now() + remainingMs).toISOString(),
    });
    this.blacklist.sweep?.().catch(() => undefined);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new ApiError('用户不存在。', 404);
    return toPublicUser(user);
  }

  async updateNickname(userId: string, nickname: unknown): Promise<PublicUser> {
    const nicknameValue = assertNickname(nickname);
    const updated = await this.users.updateNickname(userId, nicknameValue);
    if (!updated) throw new ApiError('用户不存在。', 404);
    return toPublicUser(updated);
  }

  /** 校验 Bearer token：签名有效 + 未进入黑名单 */
  async authenticate(token: string | undefined): Promise<{ payload: AuthTokenPayload; user: PublicUser }> {
    if (!token) throw new ApiError('未登录。', 401);
    const result = verifyAuthToken(token, this.jwtConfig);
    if (result.ok === false) {
      const reasonText = result.reason === 'expired' ? '登录已过期，请重新登录。' : '登录状态无效，请重新登录。';
      throw new ApiError(reasonText, 401);
    }
    if (await this.blacklist.has(result.payload.jti)) throw new ApiError('登录已失效，请重新登录。', 401);
    const user = await this.users.findById(result.payload.sub);
    if (!user) throw new ApiError('用户不存在。', 404);
    return { payload: result.payload, user: toPublicUser(user) };
  }
}
