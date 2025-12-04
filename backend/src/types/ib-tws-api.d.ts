declare module "ib-tws-api" {
  import { EventEmitter } from "events";

  export interface ClientOptions {
    host?: string;
    port?: number;
    clientId?: number;
    timeoutMs?: number;
  }

  export interface Contract {
    symbol: string;
    secType: string;
    currency: string;
    exchange?: string;
    conId?: number;
  }

  export interface Order {
    orderId: number;
    action: string;
    orderType: string;
    totalQuantity: number;
    lmtPrice?: number;
    auxPrice?: number;
  }

  export class Client {
    constructor(options?: ClientOptions);

    serverVersion: number;

    connect(options?: ClientOptions): Promise<void>;
    disconnect(): void;
    getCurrentTime(): Promise<number>;

    reqAccountUpdates(params: {
      subscribe: boolean;
      accountCode: string;
    }): Promise<void>;
  }

  export { Contract, Order };
}
