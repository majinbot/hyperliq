import { test, expect } from 'bun:test';
import { Hyperliquid } from '../../src';
import { PRIVATE_KEY, WALLET_ADDRESS, cachedApiCall } from '../setup';

const sdk = new Hyperliquid(PRIVATE_KEY, false, WALLET_ADDRESS);

test("getSpotMeta - verify structure", async () => {
    const spotMeta = await cachedApiCall('spotMeta', () => sdk.info.spot.getSpotMeta());
    expect(spotMeta).toBeDefined();
    expect(Array.isArray(spotMeta.tokens)).toBe(true);
    expect(Array.isArray(spotMeta.universe)).toBe(true);
});

if (WALLET_ADDRESS) {
    test("getSpotClearinghouseState - verify structure", async () => {
        const state = await cachedApiCall(`spotClearinghouseState-${WALLET_ADDRESS}`,
            () => sdk.info.spot.getSpotClearinghouseState(WALLET_ADDRESS!)
        );
        expect(state).toBeDefined();
        // We can check if balances array exists:
        expect(Array.isArray(state.balances)).toBe(true);
    });
} else {
    test.skip("getSpotClearinghouseState - no user address provided", () => {});
}
