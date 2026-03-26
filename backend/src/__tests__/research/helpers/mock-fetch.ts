import { vi } from "vitest";

export function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

export function mockFetchError(status: number, body = "Error") {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: body,
    json: () => Promise.resolve({ error: body }),
    text: () => Promise.resolve(body),
  });
}
