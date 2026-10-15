import http from "node:http";
import https from "node:https";

/**
 * 基于 node:https 的 HTTP 客户端：绕开 undici fetch 的连接层
 * （实测 undici 对 api.github.com 会 Connect Timeout，而 node:https/curl 正常）。
 * 不自动跟随重定向（调用方按 redirect: 'error' 语义处理）。
 */
export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export function httpRequest(
  url: string,
  opts?: { headers?: Record<string, string>; timeoutMs?: number; method?: string },
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request(
      u,
      {
        method: opts?.method ?? "GET",
        headers: opts?.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      },
    );
    req.setTimeout(opts?.timeoutMs ?? 30_000, () => {
      req.destroy(new Error(`请求超时（${(opts?.timeoutMs ?? 30_000) / 1000}s）`));
    });
    req.on("error", reject);
    req.end();
  });
}
