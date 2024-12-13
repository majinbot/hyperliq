import { ethers } from 'ethers';
import { InfoAPI } from './info';
import { ExchangeAPI } from './exchange';
import { CancelOrderRequest, OrderRequest, OrderResponse, OrderType, UserOpenOrders } from '../types';
import { CancelOrderResponse } from '../utils/signing';
import { SymbolConversion } from '../utils/symbolConversion';

export class CustomOperations {
    private exchange: ExchangeAPI;
    private infoApi: InfoAPI;
    private wallet: ethers.Wallet;
    private symbolConversion: SymbolConversion;
    private readonly walletAddress: string | null;
    private DEFAULT_SLIPPAGE = 0.05;

    constructor(
        exchange: ExchangeAPI,
        infoApi: InfoAPI,
        privateKey: string,
        symbolConversion: SymbolConversion,
        walletAddress: string | null = null
    ) {
        this.exchange = exchange;
        this.infoApi = infoApi;
        this.wallet = new ethers.Wallet(privateKey);
        this.symbolConversion = symbolConversion;
        this.walletAddress = walletAddress;
    }

    async cancelAllOrders(symbol?: string): Promise<CancelOrderResponse> {
        const address = this.walletAddress || this.wallet.address;
        const openOrders: UserOpenOrders = await this.infoApi.getUserOpenOrders(address);

        // Convert symbols once
        for (const order of openOrders) {
            order.coin = await this.symbolConversion.convertSymbol(order.coin);
        }

        let ordersToCancel: UserOpenOrders;
        if (symbol) {
            ordersToCancel = openOrders.filter(order => order.coin === symbol);
        } else {
            ordersToCancel = openOrders;
        }

        if (ordersToCancel.length === 0) {
            throw new Error('No orders to cancel');
        }

        const cancelRequests: CancelOrderRequest[] = ordersToCancel.map(order => ({
            coin: order.coin,
            o: order.oid
        }));

        return this.exchange.cancelOrder(cancelRequests);
    }

    async getAllAssets(): Promise<{ perp: string[], spot: string[] }> {
        return this.symbolConversion.getAllAssets();
    }

    private async getSlippagePrice(
        symbol: string,
        isBuy: boolean,
        slippage: number,
        px?: number
    ): Promise<number> {
        // symbol is already external (BTC-PERP), convert it once for internal usage
        const convertedSymbol = await this.symbolConversion.convertSymbol(symbol);

        let price = px;
        if (!price) {
            const allMids = await this.infoApi.getAllMids();
            price = Number(allMids[convertedSymbol]);
        }

        const isSpot = symbol.includes("-SPOT");

        const decimals = (price?.toString().split('.')[1]?.length || 0);
        // Ensure decimals - 1 is never negative
        const roundingDecimals = Math.max(isSpot ? 8 : decimals - 1, 0);

        price = price * (isBuy ? (1 + slippage) : (1 - slippage));
        return Number(price.toFixed(roundingDecimals));
    }

    async marketOpen(
        symbol: string,
        isBuy: boolean,
        size: number,
        px?: number,
        slippage: number = this.DEFAULT_SLIPPAGE,
        cloid?: string
    ): Promise<OrderResponse> {
        // Convert once at start
        const convertedSymbol = await this.symbolConversion.convertSymbol(symbol);
        const slippagePrice = await this.getSlippagePrice(symbol, isBuy, slippage, px);

        const orderRequest: OrderRequest = {
            coin: convertedSymbol,
            is_buy: isBuy,
            sz: size,
            limit_px: slippagePrice,
            order_type: { limit: { tif: 'Ioc' } } as OrderType,
            reduce_only: false
        };

        if (cloid) {
            orderRequest.cloid = cloid;
        }

        return this.exchange.placeOrder(orderRequest);
    }

    async marketClose(
        symbol: string,
        size?: number,
        px?: number,
        slippage: number = this.DEFAULT_SLIPPAGE,
        cloid?: string
    ): Promise<OrderResponse> {
        // Convert once
        const convertedSymbol = await this.symbolConversion.convertSymbol(symbol);
        const address = this.walletAddress || this.wallet.address;
        const positions = await this.infoApi.perpetuals.getClearinghouseState(address);

        for (const position of positions.assetPositions) {
            const item = position.position;
            if (convertedSymbol !== item.coin) continue;

            const szi = parseFloat(item.szi);
            if (szi === 0) {
                throw new Error(`No position to close for ${convertedSymbol}`);
            }

            const closeSize = size || Math.abs(szi);
            const isBuy = szi < 0;
            const slippagePrice = await this.getSlippagePrice(symbol, isBuy, slippage, px);

            const orderRequest: OrderRequest = {
                coin: convertedSymbol,
                is_buy: isBuy,
                sz: closeSize,
                limit_px: slippagePrice,
                order_type: { limit: { tif: 'Ioc' } } as OrderType,
                reduce_only: true
            };

            if (cloid) {
                orderRequest.cloid = cloid;
            }

            return this.exchange.placeOrder(orderRequest);
        }

        throw new Error(`No position found for ${convertedSymbol}`);
    }

    async closeAllPositions(slippage: number = this.DEFAULT_SLIPPAGE): Promise<OrderResponse[]> {
        const address = this.walletAddress || this.wallet.address;
        const positions = await this.infoApi.perpetuals.getClearinghouseState(address);
        const closeOrders: Promise<OrderResponse>[] = [];

        for (const position of positions.assetPositions) {
            const item = position.position;
            if (parseFloat(item.szi) !== 0) {
                // Convert the coin forward to external symbol once
                const symbol = await this.symbolConversion.convertSymbol(item.coin, "forward");
                closeOrders.push(this.marketClose(symbol, undefined, undefined, slippage));
            }
        }

        if (closeOrders.length === 0) {
            // No positions to close, return empty array
            return [];
        }

        return Promise.all(closeOrders);
    }
}
