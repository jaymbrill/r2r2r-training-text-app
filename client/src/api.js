async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.errors?.join('; ') || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  createUser: (profile) => request('/users', { method: 'POST', body: JSON.stringify(profile) }),
  getUser: (id) => request(`/users/${id}`),
  updateUser: (id, updates) => request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  stravaStatus: (id) => request(`/strava/status/${id}`),
  stravaSync: (id) => request(`/strava/sync/${id}`, { method: 'POST' }),
  stravaLoad: (id) => request(`/strava/load/${id}`),
  stravaDisconnect: (id) => request(`/strava/connection/${id}`, { method: 'DELETE' }),
};
