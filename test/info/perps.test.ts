import { test, expect } from 'bun:test';
import { Hyperliquid } from '../../src';
import { PRIVATE_KEY, WALLET_ADDRESS, cachedApiCall } from '../setup';

const sdk = new Hyperliquid(PRIVATE_KEY, false, WALLET_ADDRESS);

test("getPerpetualsMeta - verify structure", async () => {
    const perpsMeta = await cachedApiCall('perpsMeta', () => sdk.info.perpetuals.getMeta());
    expect(perpsMeta).toBeDefined();
    expect(Array.isArray(perpsMeta.universe)).toBe(true);
});

if (WALLET_ADDRESS) {
    test("getClearinghouseState - verify structure", async () => {
        const state = await cachedApiCall(`clearinghouseState-${WALLET_ADDRESS}`,
            () => sdk.info.perpetuals.getClearinghouseState(WALLET_ADDRESS!)
        );
        expect(state).toBeDefined();
        // Check some fields
        expect(Array.isArray(state.assetPositions)).toBe(true);
    });
} else {
    test.skip("getClearinghouseState - no user address provided", () => {});
}
