import { Response } from "express";

type SSEEventType = "position" | "order" | "allocation" | "connection" | "scanner" | "scanner_job" | "wheel_scanner" | "research_job" | "wheel_strategy" | "macro" | "quote" | "roll_progress";

interface SSEMessage {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
}

class SSEService {
  private clients: Map<string, Response> = new Map();
  private clientCounter = 0;

  addClient(res: Response): string {
    const clientId = `client-${++this.clientCounter}`;
    this.clients.set(clientId, res);
    console.log(`SSE client connected: ${clientId} (total: ${this.clients.size})`);
    return clientId;
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    console.log(`SSE client disconnected: ${clientId} (remaining: ${this.clients.size})`);
  }

  broadcast(type: SSEEventType, data: unknown): void {
    const message: SSEMessage = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    const messageStr = `data: ${JSON.stringify(message)}\n\n`;

    const failedClients: string[] = [];
    for (const [clientId, res] of this.clients.entries()) {
      try {
        res.write(messageStr);
      } catch (err) {
        console.error(`Failed to send to client ${clientId}:`, err);
        failedClients.push(clientId);
      }
    }
    for (const clientId of failedClients) {
      this.removeClient(clientId);
    }
  }

  sendToClient(clientId: string, type: SSEEventType, data: unknown): void {
    const res = this.clients.get(clientId);
    if (!res) return;

    const message: SSEMessage = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    try {
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch (err) {
      console.error(`Failed to send to client ${clientId}:`, err);
      this.removeClient(clientId);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const sseService = new SSEService();
