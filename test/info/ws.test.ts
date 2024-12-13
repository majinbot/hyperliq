import { test, expect } from 'bun:test';
import { Hyperliquid } from '../../src';
import { PRIVATE_KEY, WALLET_ADDRESS } from '../setup';

const sdk = new Hyperliquid(PRIVATE_KEY, false, WALLET_ADDRESS);

test("WebSocket - subscribeToAllMids", async () => {
    // Short test: connect, subscribe, wait for one message
    await sdk.connect();

    const receivedData: any[] = [];
    await new Promise(async (resolve, reject) => {
        await sdk.subscriptions.subscribeToAllMids((data) => {
            receivedData.push(data);
            // After we receive at least one update, we can resolve
            if (receivedData.length > 0) {
                resolve(null);
            }
        });
        setTimeout(() => reject(new Error("Timeout waiting for allMids")), 5000);
    });

    expect(receivedData.length).toBeGreaterThan(0);
    sdk.disconnect();
});
