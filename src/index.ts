import { InfoAPI } from './rest/info';
import { ExchangeAPI } from './rest/exchange';
import { WebSocketClient } from './websocket/connection';
import { WebSocketSubscriptions } from './websocket/subscriptions';
import { RateLimiter } from './utils/rateLimiter';
import { CustomOperations } from './rest/custom';
import { ethers } from 'ethers';
import { SymbolConversion } from './utils/symbolConversion';
import { AuthenticationError } from './utils/errors';
import * as CONSTANTS from './constants';

export class Hyperliquid {
  public info: InfoAPI;
  public exchange: ExchangeAPI;
  public ws: WebSocketClient;
  public subscriptions: WebSocketSubscriptions;
  public custom: CustomOperations;

  private readonly rateLimiter: RateLimiter;
  private readonly symbolConversion: SymbolConversion;
  private _isValidPrivateKey: boolean = false;
  private readonly walletAddress: string | null = null;

  constructor(privateKey: string | null = null, testnet: boolean = false, walletAddress: string | null = null) {
    const baseURL = testnet ? CONSTANTS.BASE_URLS.TESTNET : CONSTANTS.BASE_URLS.PRODUCTION;

    this.rateLimiter = new RateLimiter();
    this.symbolConversion = new SymbolConversion(baseURL, this.rateLimiter);

    this.info = new InfoAPI(baseURL, this.rateLimiter, this.symbolConversion);
    this.ws = new WebSocketClient(testnet);
    this.subscriptions = new WebSocketSubscriptions(this.ws, this.symbolConversion);

    // Create proxy objects for exchange and custom
    this.exchange = this.createAuthenticatedProxy(ExchangeAPI);
    this.custom = this.createAuthenticatedProxy(CustomOperations);

    this.walletAddress = walletAddress;

    if (privateKey) {
      this.initializeWithPrivateKey(privateKey, testnet);
    }
  }

  get isValidPrivateKey(): boolean {
    return this._isValidPrivateKey;
  }

  private createAuthenticatedProxy<T extends object>(Class: new (...args: any[]) => T): T {
    return new Proxy({} as T, {
      get: (target, prop) => {
        if (!this._isValidPrivateKey) {
          throw new AuthenticationError('Invalid or missing private key. This method requires authentication.');
        }
        return target[prop as keyof T];
      }
    });
  }

  private initializeWithPrivateKey(privateKey: string, testnet: boolean = false): void {
    try {
      const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}` as `0x${string}`;
      new ethers.Wallet(formattedPrivateKey); // Validate the private key
      
      this.exchange = new ExchangeAPI(testnet, formattedPrivateKey, this.rateLimiter, this.symbolConversion, this.walletAddress);
      this.custom = new CustomOperations(this.exchange, this.info, formattedPrivateKey, this.symbolConversion, this.walletAddress);
      this._isValidPrivateKey = true;
    } catch (error) {
      console.warn("Invalid private key provided. Some functionalities will be limited.");
      this._isValidPrivateKey = false;
    }
  }

  public isAuthenticated(): boolean {
    return this._isValidPrivateKey;
  }

  async connect(): Promise<void> {
    await this.ws.connect();
    if (!this._isValidPrivateKey) {
      console.warn("Not authenticated. Some WebSocket functionalities may be limited.");
    }
  }

  disconnect(): void {
    this.ws.close();
  }
}

export * from './types';
export * from './utils/signing';
