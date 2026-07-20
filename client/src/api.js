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
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  stravaStatus: (id) => request(`/strava/status/${id}`),
  stravaSync: (id) => request(`/strava/sync/${id}`, { method: 'POST' }),
  stravaLoad: (id) => request(`/strava/load/${id}`),
  stravaDisconnect: (id) => request(`/strava/connection/${id}`, { method: 'DELETE' }),
  generatePlan: (id) => request(`/plans/generate/${id}`, { method: 'POST' }),
  currentPlan: (id) => request(`/plans/current/${id}`),
  workouts: (id, from, to) => request(`/plans/workouts/${id}?from=${from}&to=${to}`),
  calendar: (id, from, to) => request(`/plans/calendar/${id}?from=${from}&to=${to}`),
  updateWorkout: (workoutId, updates) =>
    request(`/plans/workouts/${workoutId}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  sendNightly: (id) => request(`/plans/send-nightly/${id}`, { method: 'POST' }),
  compliance: (id, days = 28) => request(`/plans/compliance/${id}?days=${days}`),
  chatHistory: (id) => request(`/chat/${id}/messages`),
  chatSend: (id, message) =>
    request(`/chat/${id}/messages`, { method: 'POST', body: JSON.stringify({ message }) }),
};
