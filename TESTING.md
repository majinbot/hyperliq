## Testing Against Live Data
The SDK supports live integration tests against the Hyperliquid API. Since tests run live and can consume real rate limits, follow these guidelines:


### 1. Set Environment Variables:
Before running tests, make sure you have a .env file with your private key (if needed):

```env
HYPERLIQUID_PRIVATE_KEY=0xabc123...
HYPERLIQUID_WALLET_ADDRESS=0xdef456... // only if using API Agent wallet
```


### 2. Install and Build:
```bash
bun install
bun run tsc
```


### 3. Run Tests:
```bash
bun test
```

The tests will connect to the API and run live calls. Make sure to:
1. Minimize the number of tests that hit the most expensive endpoints.
2. Introduce caching in your tests. For example, fetch getAllMids() once and reuse the result.
3. Add short delays between tests (like await new Promise(r => setTimeout(r, 1000))) to avoid triggering IP-based rate limits quickly.

```bash
bun test tests/basic.test.ts
```

*If you find yourself hitting rate limits, reduce test frequency or add longer delays.*