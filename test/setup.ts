import { config } from 'dotenv';
config();

export const PRIVATE_KEY = process.env.HYPERLIQUID_PRIVATE_KEY || null;
export const WALLET_ADDRESS = process.env.HYPERLIQUID_WALLET_ADDRESS || null;

// Global cache and delay
const globalCache: Record<string, any> = {};

export async function cachedApiCall<T>(key: string, fn: () => Promise<T>, delayMs: number = 1000): Promise<T> {
    if (globalCache[key]) return globalCache[key];

    await new Promise(resolve => setTimeout(resolve, delayMs));
    const data = await fn();
    globalCache[key] = data;
    return data;
}
