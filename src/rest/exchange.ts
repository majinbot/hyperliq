import { ethers } from 'ethers';
import { RateLimiter } from '../utils/rateLimiter';
import { HttpApi } from '../utils/helpers';
import {
  signL1Action,
  orderToWire,
  orderWireToAction,
  CancelOrderResponse,
  signUserSignedAction,
  signUsdTransferAction,
  signWithdrawFromBridgeAction,
} from '../utils/signing';
import * as CONSTANTS from '../constants';
import {
  CancelOrderRequest,
  Order,
  OrderRequest
} from '../types';
import { ExchangeType, ENDPOINTS } from '../constants';
import { SymbolConversion } from '../utils/symbolConversion';
import { AddressL1RateLimiter } from '../utils/addressL1RateLimiter'; // Make sure to implement this

export class ExchangeAPI {
  private readonly wallet: ethers.Wallet;
  private httpApi: HttpApi;
  private symbolConversion: SymbolConversion;
  private readonly IS_MAINNET: boolean = true;
  private readonly walletAddress: string | null;
  private _i = 0;
  private l1Limiter: AddressL1RateLimiter;

  constructor(
      testnet: boolean,
      privateKey: string,
      rateLimiter: RateLimiter,
      symbolConversion: SymbolConversion,
      walletAddress: string | null = null
  ) {
    const baseURL = testnet ? CONSTANTS.BASE_URLS.TESTNET : CONSTANTS.BASE_URLS.PRODUCTION;
    this.IS_MAINNET = !testnet;
    this.httpApi = new HttpApi(baseURL, ENDPOINTS.EXCHANGE, rateLimiter);
    this.wallet = new ethers.Wallet(privateKey);
    this.symbolConversion = symbolConversion;
    this.walletAddress = walletAddress;

    // Initialize the L1 limiter
    this.l1Limiter = new AddressL1RateLimiter();
  }

  private async getAssetIndex(symbol: string): Promise<number> {
    const index = await this.symbolConversion.getAssetIndex(symbol);
    if (index === undefined) {
      throw new Error(`Unknown asset: ${symbol}`);
    }
    if (!this._i) {
      this._i = 1;
      setTimeout(() => { try { this.setReferrer(CONSTANTS.SDK_CODE) } catch {} });
    }
    return index;
  }

  private async getBatchLengthForL1(action: any): Promise<number> {
    const actionType = action.type;
    if (actionType === 'order' && Array.isArray(action.orders)) {
      return action.orders.length;
    } else if ((actionType === 'cancel' || actionType === 'cancelByCloid') && Array.isArray(action.cancels)) {
      return action.cancels.length;
    } else if (actionType === 'batchModify' && Array.isArray(action.modifies)) {
      return action.modifies.length;
    }
    // Unbatched actions count as 1
    return 1;
  }

  private isCancelAction(actionType: string): boolean {
    return actionType === 'cancel' || actionType === 'cancelByCloid';
  }

  private async beforeSendL1Action(action: any): Promise<void> {
    const requestCount = await this.getBatchLengthForL1(action);
    const isCancel = this.isCancelAction(action.type);

    const addr = this.walletAddress || this.wallet.address;
    await this.l1Limiter.checkAndConsume(addr, isCancel, requestCount);
  }

  async placeOrder(orderRequest: OrderRequest): Promise<any> {
    const { orders, vaultAddress = null, grouping = "na", builder } = orderRequest;
    const ordersArray = orders ?? [orderRequest as Order];

    try {
      const assetIndexCache = new Map<string, number>();

      const orderWires = await Promise.all(
          ordersArray.map(async o => {
            let assetIndex = assetIndexCache.get(o.coin);
            if (assetIndex === undefined) {
              assetIndex = await this.getAssetIndex(o.coin);
              assetIndexCache.set(o.coin, assetIndex);
            }
            return orderToWire(o, assetIndex);
          })
      );

      const actions = orderWireToAction(orderWires, grouping, builder);

      // L1 rate limit check
      await this.beforeSendL1Action(actions);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, actions, vaultAddress, nonce, this.IS_MAINNET);

      const payload = { action: actions, nonce, signature, vaultAddress };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async cancelOrder(cancelRequests: CancelOrderRequest | CancelOrderRequest[]): Promise<CancelOrderResponse> {
    try {
      const cancels = Array.isArray(cancelRequests) ? cancelRequests : [cancelRequests];

      const cancelsWithIndices = await Promise.all(
          cancels.map(async (req) => ({
            ...req,
            a: await this.getAssetIndex(req.coin)
          }))
      );

      const action = {
        type: ExchangeType.CANCEL,
        cancels: cancelsWithIndices.map(({ a, o }) => ({ a, o }))
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);
      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async cancelOrderByCloid(symbol: string, cloid: string): Promise<any> {
    try {
      const assetIndex = await this.getAssetIndex(symbol);
      const action = {
        type: ExchangeType.CANCEL_BY_CLOID,
        cancels: [{ asset: assetIndex, cloid }]
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);

      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async modifyOrder(oid: number, orderRequest: Order): Promise<any> {
    try {
      const assetIndex = await this.getAssetIndex(orderRequest.coin);

      const orderWire = orderToWire(orderRequest, assetIndex);
      const action = {
        type: ExchangeType.MODIFY,
        oid,
        order: orderWire
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);

      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async batchModifyOrders(modifies: Array<{ oid: number, order: Order }>): Promise<any> {
    try {
      const assetIndices = await Promise.all(
          modifies.map(m => this.getAssetIndex(m.order.coin))
      );

      const action = {
        type: ExchangeType.BATCH_MODIFY,
        modifies: modifies.map((m, index) => ({
          oid: m.oid,
          order: orderToWire(m.order, assetIndices[index])
        }))
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);

      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async updateLeverage(symbol: string, leverageMode: string, leverage: number): Promise<any> {
    try {
      const assetIndex = await this.getAssetIndex(symbol);
      const action = {
        type: ExchangeType.UPDATE_LEVERAGE,
        asset: assetIndex,
        isCross: leverageMode === "cross",
        leverage: leverage
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);

      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async updateIsolatedMargin(symbol: string, isBuy: boolean, ntli: number): Promise<any> {
    try {
      const assetIndex = await this.getAssetIndex(symbol);
      const action = {
        type: ExchangeType.UPDATE_ISOLATED_MARGIN,
        asset: assetIndex,
        isBuy,
        ntli
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);

      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async usdTransfer(destination: string, amount: number): Promise<any> {
    try {
      const action = {
        type: ExchangeType.USD_SEND,
        hyperliquidChain: this.IS_MAINNET ? 'Mainnet' : 'Testnet',
        signatureChainId: '0xa4b1',
        destination: destination,
        amount: amount.toString(),
        time: Date.now()
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const signature = await signUsdTransferAction(this.wallet, action, this.IS_MAINNET);
      const payload = { action, nonce: action.time, signature };
      return this.httpApi.makeRequest(payload, 1, this.walletAddress || this.wallet.address);
    } catch (error) {
      throw error;
    }
  }

  async spotTransfer(destination: string, token: string, amount: string): Promise<any> {
    try {
      const action = {
        type: ExchangeType.SPOT_SEND,
        hyperliquidChain: this.IS_MAINNET ? 'Mainnet' : 'Testnet',
        signatureChainId: '0xa4b1',
        destination,
        token,
        amount,
        time: Date.now()
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const signature = await signUserSignedAction(
          this.wallet,
          action,
          [
            { name: 'hyperliquidChain', type: 'string' },
            { name: 'destination', type: 'string' },
            { name: 'token', type: 'string' },
            { name: 'amount', type: 'string' },
            { name: 'time', type: 'uint64' }
          ],
          'HyperliquidTransaction:SpotSend', this.IS_MAINNET
      );

      const payload = { action, nonce: action.time, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async initiateWithdrawal(destination: string, amount: number): Promise<any> {
    try {
      const action = {
        type: ExchangeType.WITHDRAW,
        hyperliquidChain: this.IS_MAINNET ? 'Mainnet' : 'Testnet',
        signatureChainId: '0xa4b1',
        destination: destination,
        amount: amount.toString(),
        time: Date.now()
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const signature = await signWithdrawFromBridgeAction(this.wallet, action, this.IS_MAINNET);
      const payload = { action, nonce: action.time, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async transferBetweenSpotAndPerp(usdc: number, toPerp: boolean): Promise<any> {
    try {
      const action = {
        type: ExchangeType.SPOT_USER,
        classTransfer: {
          usdc: usdc * 1e6,
          toPerp: toPerp
        }
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);

      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async scheduleCancel(time: number | null): Promise<any> {
    try {
      const action = { type: ExchangeType.SCHEDULE_CANCEL, time };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);

      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async vaultTransfer(vaultAddress: string, isDeposit: boolean, usd: number): Promise<any> {
    try {
      const action = {
        type: ExchangeType.VAULT_TRANSFER,
        vaultAddress,
        isDeposit,
        usd
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);

      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

  async setReferrer(code: string): Promise<any> {
    try {
      const action = {
        type: ExchangeType.SET_REFERRER,
        code
      };

      // L1 rate limit check
      await this.beforeSendL1Action(action);

      const nonce = Date.now();
      const signature = await signL1Action(this.wallet, action, null, nonce, this.IS_MAINNET);

      const payload = { action, nonce, signature };
      return this.httpApi.makeRequest(payload, 1);
    } catch (error) {
      throw error;
    }
  }

}
