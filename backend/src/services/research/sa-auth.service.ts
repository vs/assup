import { prisma } from "./db.js";

const SA_CREDS_KEY = "sa_credentials";

export interface SAAuthStatus {
  configured: boolean;
  source: "database" | "environment" | "none";
  maskedEmail?: string;
}

export interface SACredentials {
  email: string;
  password: string;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  if (local.length <= 2) return local[0] + "***@" + domain;
  return local[0] + "***" + local.slice(-1) + "@" + domain;
}

export async function getSACredentials(): Promise<SACredentials | null> {
  const setting = await prisma.setting.findUnique({ where: { key: SA_CREDS_KEY } });
  if (setting) {
    const val = setting.value as unknown as SACredentials;
    if (val.email && val.password) return val;
  }

  const email = process.env.SA_EMAIL;
  const password = process.env.SA_PASSWORD;
  if (email && password) return { email, password };

  return null;
}

export async function setSACredentials(email: string, password: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SA_CREDS_KEY },
    create: { key: SA_CREDS_KEY, value: { email, password } },
    update: { value: { email, password } },
  });
}

export async function deleteSACredentials(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: SA_CREDS_KEY } });
}

export async function getSAAuthStatus(): Promise<SAAuthStatus> {
  const dbSetting = await prisma.setting.findUnique({ where: { key: SA_CREDS_KEY } });
  if (dbSetting) {
    const val = dbSetting.value as unknown as SACredentials;
    if (val.email && val.password) {
      return { configured: true, source: "database", maskedEmail: maskEmail(val.email) };
    }
  }

  const email = process.env.SA_EMAIL;
  const password = process.env.SA_PASSWORD;
  if (email && password) {
    return { configured: true, source: "environment", maskedEmail: maskEmail(email) };
  }

  return { configured: false, source: "none" };
}
