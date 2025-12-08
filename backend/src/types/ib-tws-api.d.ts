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
    primaryExchange?: string;
  }

  export interface HistoricalBar {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    average: number;
    barCount: number;
  }

  export interface HistoricalDataParams {
    contract: Contract;
    endDateTime?: string;
    duration: string;
    barSizeSetting: string;
    whatToShow: string;
    useRth: number;
    formatDate: number;
  }

  export interface Order {
    orderId: number;
    action: string;
    orderType: string;
    totalQuantity: number;
    lmtPrice?: number;
    auxPrice?: number;
  }

  export interface Position {
    account: string;
    contract: Contract & { primaryExchange?: string };
    pos: number;
    avgCost: number;
  }

  export class Client {
    constructor(options?: ClientOptions);

    serverVersion: number;

    connect(options?: ClientOptions): Promise<void>;
    disconnect(): void;
    getCurrentTime(): Promise<number>;

    getPositions(): Promise<Position[]>;

    reqAccountUpdates(params: {
      subscribe: boolean;
      accountCode: string;
    }): Promise<void>;

    getHistoricalData(params: HistoricalDataParams): Promise<HistoricalBar[]>;
  }

  export { Contract, Order };
}
