export const config = {
  api: {
    port: Number(process.env["API_PORT"] ?? 3001),
  },
  worker: {
    port: Number(process.env["WORKER_PORT"] ?? 3002),
  },
} as const;
