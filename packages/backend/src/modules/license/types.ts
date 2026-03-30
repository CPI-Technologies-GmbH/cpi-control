export interface LicenseLimits {
  maxServices: number;
  maxAgents: number;
}

export interface LicenseInfo {
  token: string;
  plan: 'free' | 'team' | 'unlimited';
  limits: LicenseLimits;
  expiresAt: string | null;
  lastValidated: string;
  offlineSince: string | null;
  machineId: string;
}

export type LicenseStatus = 'active' | 'expired' | 'grace' | 'free';

export const FREE_LIMITS: LicenseLimits = { maxServices: 50, maxAgents: 1 };
export const GRACE_PERIOD_DAYS = 7;
export const VALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || 'https://cpi-control-website.vercel.app';
