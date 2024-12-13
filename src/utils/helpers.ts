import axios, { AxiosInstance } from 'axios';
import { handleApiError } from './errors';
import { RateLimiter } from './rateLimiter';

export class HttpApi {
    private client: AxiosInstance;
    private rateLimiter: RateLimiter;
    private readonly endpoint: string;

    constructor(baseUrl: string, endpoint: string = "/", rateLimiter: RateLimiter) {
        this.endpoint = endpoint;
        this.client = axios.create({
            baseURL: baseUrl,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        this.rateLimiter = rateLimiter;
    }

    private async calculateWeight(payload: any): Promise<number> {
        // 1. Check if this is an Exchange request (action-based)
        if (payload.action) {
            // Exchange requests
            // Weight = 1 + floor(batch_length / 40)
            // batch_length = number of orders or cancels or modifies
            const actionType = payload.action.type;
            let batchLength = 1;
            if (actionType === 'order' && Array.isArray(payload.action.orders)) {
                batchLength = payload.action.orders.length;
            } else if ((actionType === 'cancel' || actionType === 'cancelByCloid') && Array.isArray(payload.action.cancels)) {
                batchLength = payload.action.cancels.length;
            } else if (actionType === 'batchModify' && Array.isArray(payload.action.modifies)) {
                batchLength = payload.action.modifies.length;
            }
            return 1 + Math.floor(batchLength / 40);
        }

        // 2. Info and Explorer requests (payload.type)
        if (payload.type) {
            const infoType = payload.type;
            // The following info requests have weight 2: l2Book, allMids, clearinghouseState, orderStatus, spotClearinghouseState, exchangeStatus
            const weight2Types = [
                'l2Book',
                'allMids',
                'clearinghouseState',
                'orderStatus',
                'spotClearinghouseState',
                'exchangeStatus'
            ];

            if (weight2Types.includes(infoType)) {
                return 2;
            }

            // Explorer requests have weight 40, but let's assume we detect them by a known prefix or separate endpoint
            // If you have a specific indicator that identifies explorer requests, use that here.
            // For demonstration, if endpoint == '/explorer' treat as explorer request.
            if (this.endpoint.includes('explorer')) {
                return 40;
            }

            // All other documented info requests have weight 20
            return 20;
        }

        // If none of the above match, default to 2 (as a fallback)
        return 2;
    }

    async makeRequest(payload: any, defaultWeight: number = 2, userAddress?: string): Promise<any> {
        try {
            const weight = await this.calculateWeight(payload);
            await this.rateLimiter.waitForToken(weight);

            const response = await this.client.post(this.endpoint, payload);
            return response.data;
        } catch (error) {
            handleApiError(error);
        }
    }
}
