import { test, expect } from 'bun:test';
import { Hyperliquid } from '../../src';
import { PRIVATE_KEY, WALLET_ADDRESS, cachedApiCall } from '../setup';

const sdk = new Hyperliquid(PRIVATE_KEY, false, WALLET_ADDRESS);
const TEST_SYMBOL = "BTC-PERP";

test("getAllMids - verify data structure", async () => {
    const allMids = await cachedApiCall('allMids', () => sdk.info.getAllMids());
    expect(allMids).toBeDefined();
    expect(Object.keys(allMids).length).toBeGreaterThan(0);
});

test("getL2Book for BTC-PERP", async () => {
    const l2Book = await cachedApiCall('l2Book-BTC-PERP', () => sdk.info.getL2Book(TEST_SYMBOL));
    expect(l2Book).toBeDefined();
    expect(Array.isArray(l2Book.levels)).toBe(true);
    expect(l2Book.levels.length).toBe(2);
});

// If WALLET_ADDRESS is unknown or invalid, consider skipping this test
if (WALLET_ADDRESS) {
    test("getUserOpenOrders - should return an array", async () => {
        // If this fails due to a 422, ensure WALLET_ADDRESS is a valid user or skip test
        const userOpenOrders = await cachedApiCall(`userOpenOrders-${WALLET_ADDRESS}`, () => sdk.info.getUserOpenOrders(WALLET_ADDRESS!));
        expect(Array.isArray(userOpenOrders)).toBe(true);
    });
} else {
    test.skip("getUserOpenOrders - skipped due to missing WALLET_ADDRESS", () => {});
}

test("Candle snapshot - BTC-PERP 1m interval", async () => {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - 60;
    const candles = await cachedApiCall(`candleSnapshot-${TEST_SYMBOL}-1m`,
        () => sdk.info.getCandleSnapshot(TEST_SYMBOL, "1m", startTime, endTime)
    );
    expect(Array.isArray(candles)).toBe(true);
});
