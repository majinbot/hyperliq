interface AddressLimitState {
    lastRequestTime: number;
    // Possibly store additional info if needed
}

export class AddressL1RateLimiter {
    private readonly initialBuffer = 10000;
    private addressStates: Map<string, AddressLimitState>;

    constructor() {
        this.addressStates = new Map();
    }

    // Mock function: in practice, you'd update this to fetch actual traded USDC volume
    async getTradedUSDC(address: string): Promise<number> {
        // Return the cumulative USDC traded by this address.
        // This must be implemented by integrating with user fills or other logic.
        return 50000; // Example: address has traded 50,000 USDC so far.
    }

    // Compute the base limit (non-cancel) based on traded volume
    private async computeBaseLimit(address: string): Promise<number> {
        const traded = await this.getTradedUSDC(address);
        return this.initialBuffer + traded;
    }

    // Compute the limit for cancel requests
    private async computeCancelLimit(address: string): Promise<number> {
        const baseLimit = await this.computeBaseLimit(address);
        return Math.min(baseLimit + 100000, baseLimit * 2);
    }

    // Returns current timestamp in ms
    private now(): number {
        return Date.now();
    }

    // Called before sending a request
    async checkAndConsume(address: string, isCancel: boolean, requestCount: number): Promise<void> {
        if (!address) {
            // If there's no wallet address, skip L1 rate limiting
            return;
        }

        let state = this.addressStates.get(address);
        if (!state) {
            state = { lastRequestTime: 0 };
            this.addressStates.set(address, state);
        }

        const limit = isCancel ? await this.computeCancelLimit(address) : await this.computeBaseLimit(address);

        // If the requested count is more than the limit, the user is rate limited.
        // But they can still do one request every 10 seconds.
        if (requestCount > limit) {
            const waitTime = 10 * 1000; // 10 seconds
            const elapsed = this.now() - state.lastRequestTime;
            if (elapsed < waitTime) {
                // Need to wait until 10 seconds have passed since last request
                const toWait = waitTime - elapsed;
                await new Promise(resolve => setTimeout(resolve, toWait));
            }
        }

        // Now record this request, decrement the effective allowance
        // We do not maintain a strict decrementing counter because
        // the limit is derived from traded volume dynamically.
        // Instead, we rely on the condition check above. In a more
        // advanced implementation, you'd store how many requests
        // have been made recently and a timeframe.

        state.lastRequestTime = this.now();
    }
}
