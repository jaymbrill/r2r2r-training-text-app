import { useEffect, useState } from 'react'
import { api } from './api'

const SESSION_KEY = 'adminPassword'

export default function AdminDashboard() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(SESSION_KEY) || '')
  const [entry, setEntry] = useState('')
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async (pw) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.adminStats(pw)
      setStats(data)
      sessionStorage.setItem(SESSION_KEY, pw)
      setPassword(pw)
    } catch (err) {
      sessionStorage.removeItem(SESSION_KEY)
      setPassword('')
      setStats(null)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (password) load(password)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (entry.trim()) load(entry.trim())
  }

  if (!password || !stats) {
    return (
      <main className="admin-login">
        <h2>Admin login</h2>
        {error && <p className="error">{error}</p>}
        <form onSubmit={handleSubmit} className="profile-form">
          <label>
            Admin password
            <input
              type="password"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              autoFocus
            />
          </label>
          <button type="submit" disabled={loading}>{loading ? 'Checking…' : 'View dashboard'}</button>
        </form>
      </main>
    )
  }

  return (
    <main className="admin-dashboard">
      <div className="admin-header">
        <h2>Admin dashboard</h2>
        <button className="link" onClick={() => load(password)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="admin-stat-grid">
        <div className="admin-stat">
          <strong>{stats.totalUsers}</strong>
          <span>total signups</span>
        </div>
        <div className="admin-stat">
          <strong>{stats.signupsLast7d}</strong>
          <span>signups (7d)</span>
        </div>
        <div className="admin-stat">
          <strong>{stats.stravaConnected}</strong>
          <span>Strava connected</span>
        </div>
        <div className="admin-stat">
          <strong>{stats.phoneVerified}</strong>
          <span>phone verified</span>
        </div>
        <div className="admin-stat">
          <strong>{stats.totalPlans}</strong>
          <span>plans generated</span>
        </div>
        <div className="admin-stat">
          <strong>{stats.totalActivities}</strong>
          <span>Strava activities synced</span>
        </div>
        <div className="admin-stat">
          <strong>{stats.messages.outbound}</strong>
          <span>texts sent</span>
        </div>
        <div className="admin-stat">
          <strong>{stats.messages.inbound}</strong>
          <span>texts received</span>
        </div>
      </div>

      <h3>Users ({stats.users.length})</h3>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Goal date</th>
              <th>Strava</th>
              <th>Workouts</th>
              <th>Msgs</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {stats.users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.phone} {u.phoneVerified ? '✓' : ''}</td>
                <td>{u.goalDate || '—'}</td>
                <td>{u.stravaConnected ? '✓' : '—'}</td>
                <td>{u.workoutCount}</td>
                <td>{u.messageCount}</td>
                <td>{u.createdAt?.slice(0, 10)}</td>
              </tr>
            ))}
            {stats.users.length === 0 && (
              <tr><td colSpan="8">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}
