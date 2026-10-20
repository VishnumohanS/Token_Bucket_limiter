const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error("SentinelAI API is offline. Start the Python API and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "The request could not be completed.";
    throw new Error(detail);
  }
  return data;
}

export const api = {
  stats: () => request("/stats"),
  policies: () => request("/policies"),
  evaluate: (clientId, route) =>
    request("/requests/evaluate", {
      method: "POST",
      body: JSON.stringify({ client_id: clientId, route }),
    }),
  savePolicy: (policy) =>
    request(policy.method === "PUT" ? `/policies/${encodeURIComponent(policy.client_id)}` : "/policies", {
      method: policy.method || "POST",
      body: JSON.stringify({
        client_id: policy.client_id,
        capacity: Number(policy.capacity),
        refill_rate: Number(policy.refill_rate),
        enabled: policy.enabled ?? true,
      }),
    }),
  analytics: () => request("/analytics", { method: "POST" }),
};
