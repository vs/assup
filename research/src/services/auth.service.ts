import { prisma } from "../db/index.js";

const TOKEN_KEY = "claude_oauth_token";

export interface AuthStatus {
  configured: boolean;
  source: "database" | "environment" | "none";
  maskedToken?: string;
}

function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return token.slice(0, 12) + "..." + token.slice(-4);
}

export async function getOAuthToken(): Promise<string | null> {
  const setting = await prisma.setting.findUnique({ where: { key: TOKEN_KEY } });
  if (setting) {
    return (setting.value as { token: string }).token;
  }
  return process.env.CLAUDE_CODE_OAUTH_TOKEN || null;
}

export async function setOAuthToken(token: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: TOKEN_KEY },
    create: { key: TOKEN_KEY, value: { token } },
    update: { value: { token } },
  });
}

export async function deleteOAuthToken(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: TOKEN_KEY } });
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const dbSetting = await prisma.setting.findUnique({ where: { key: TOKEN_KEY } });
  if (dbSetting) {
    const token = (dbSetting.value as { token: string }).token;
    return { configured: true, source: "database", maskedToken: maskToken(token) };
  }

  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (envToken) {
    return { configured: true, source: "environment", maskedToken: maskToken(envToken) };
  }

  return { configured: false, source: "none" };
}
