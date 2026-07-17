import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

export default function StravaSection({ userId }) {
  const [status, setStatus] = useState(null)
  const [load, setLoad] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const s = await api.stravaStatus(userId)
      setStatus(s)
      if (s.connected) setLoad(await api.stravaLoad(userId))
    } catch (err) {
      setError(err.message)
    }
  }, [userId])

  useEffect(() => {
    refresh()
    // Show a message when returning from the OAuth flow
    const params = new URLSearchParams(window.location.search)
    const result = params.get('strava')
    if (result) {
      window.history.replaceState({}, '', window.location.pathname)
      if (result === 'denied') setError('Strava access was denied.')
      if (result === 'error') setError('Connecting Strava failed. Please try again.')
    }
  }, [refresh])

  const handleSync = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.stravaSync(userId)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.stravaDisconnect(userId)
      setStatus({ connected: false })
      setLoad(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null

  return (
    <section className="strava-section">
      <h3>Strava</h3>
      {error && <p className="error">{error}</p>}

      {!status.connected ? (
        <>
          <p>Connect Strava so your plan adapts to your actual training load.</p>
          <a className="button" href={`/api/strava/connect/${userId}`}>Connect Strava</a>
        </>
      ) : (
        <>
          <p>
            Connected (athlete {status.athleteId}) · {status.activityCount} activities synced
            {status.lastSyncAt && ` · last sync ${status.lastSyncAt} UTC`}
          </p>

          {load && (
            <div className="load-grid">
              <div className="load-card">
                <h4>Last 7 days</h4>
                <p>{load.acute7d.hours}h · {load.acute7d.distanceKm} km · {load.acute7d.elevationM} m vert</p>
              </div>
              <div className="load-card">
                <h4>Last 28 days</h4>
                <p>
                  {load.chronic28d.hours}h · {load.chronic28d.distanceKm} km · {load.chronic28d.elevationM} m vert
                  <br />
                  avg {load.chronic28d.weeklyAvgHours}h/week
                </p>
              </div>
              <div className="load-card">
                <h4>Ramp ratio</h4>
                <p>
                  {load.rampRatio ?? '—'}
                  {load.rampRatio != null && (
                    <span className="hint">
                      {load.rampRatio > 1.5
                        ? ' (ramping fast — be careful)'
                        : load.rampRatio < 0.8
                          ? ' (room to build)'
                          : ' (sustainable)'}
                    </span>
                  )}
                </p>
              </div>
              <div className="load-card">
                <h4>Biggest effort (28d)</h4>
                <p>
                  {load.biggest28d.longestHours}h · {load.biggest28d.longestKm} km ·{' '}
                  {load.biggest28d.mostElevationM} m vert
                </p>
              </div>
            </div>
          )}

          <button onClick={handleSync} disabled={busy}>{busy ? 'Working…' : 'Sync now'}</button>
          <button className="link" onClick={handleDisconnect} disabled={busy}>Disconnect</button>
        </>
      )}
    </section>
  )
}
