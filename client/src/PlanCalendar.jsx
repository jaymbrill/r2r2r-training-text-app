import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

const TYPE_LABELS = {
  run: 'Run',
  long_run: 'Long run',
  hike: 'Hike',
  vert: 'Vert',
  back_to_back: 'Back-to-back',
  cross_train: 'Cross-train',
  strength: 'Strength',
  rest: 'Rest',
}

function fmtStats(mi, ft) {
  return [
    mi != null && `${mi} mi`,
    ft != null && `${ft >= 1000 ? `${(ft / 1000).toFixed(1)}k` : ft} ft`,
  ].filter(Boolean).join(' · ')
}

function monthRange(year, month) {
  const first = new Date(Date.UTC(year, month, 1))
  const last = new Date(Date.UTC(year, month + 1, 0))
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)]
}

export default function PlanCalendar({ userId, refreshKey = 0 }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-based
  const [plan, setPlan] = useState(null)
  const [workouts, setWorkouts] = useState([])
  const [actuals, setActuals] = useState({})
  const [compliance, setCompliance] = useState(null)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [from, to] = monthRange(year, month)
      const data = await api.calendar(userId, from, to)
      setWorkouts(data.workouts)
      setActuals(data.actuals || {})
      setPlan(await api.currentPlan(userId).catch(() => null))
      setCompliance(await api.compliance(userId).catch(() => null))
    } catch (err) {
      setError(err.message)
    }
  }, [userId, year, month, refreshKey])

  useEffect(() => { refresh() }, [refresh])

  const handleGenerate = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.generatePlan(userId)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleWorkoutUpdate = async (id, updates) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateWorkout(id, updates)
      setWorkouts((ws) => ws.map((w) => (w.id === id ? updated : w)))
      setSelected(updated)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const prevMonth = () => {
    if (month === 0) { setYear(year - 1); setMonth(11) } else setMonth(month - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(year + 1); setMonth(0) } else setMonth(month + 1)
  }

  // Build the grid: pad to the first Sunday, then all days of the month
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ day: d, date, workout: workouts.find((w) => w.date === date) })
  }

  const monthName = new Date(Date.UTC(year, month, 1)).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <section className="plan-section">
      <h3>Training plan</h3>
      {error && <p className="error">{error}</p>}

      {plan ? (
        <p className="plan-summary">
          {plan.summary}
          <span className="hint"> (generated {plan.generatedAt} UTC{plan.model === 'fallback' ? ', placeholder plan — set ANTHROPIC_API_KEY for Claude plans' : ''})</span>
        </p>
      ) : (
        <p>No plan yet — generate one to see your next two weeks.</p>
      )}
      <button onClick={handleGenerate} disabled={busy}>
        {busy ? 'Working…' : plan ? 'Regenerate plan' : 'Generate plan'}
      </button>

      {compliance && compliance.totalWorkouts > 0 && (
        <div className="compliance-row">
          <div className="stat">
            <strong>{compliance.adherencePct != null ? `${compliance.adherencePct}%` : '—'}</strong>
            <span>adherence ({compliance.windowDays}d)</span>
          </div>
          <div className="stat">
            <strong>{compliance.completed}</strong>
            <span>completed</span>
          </div>
          <div className="stat">
            <strong>{compliance.skipped}</strong>
            <span>skipped</span>
          </div>
          <div className="stat">
            <strong>{compliance.streak}</strong>
            <span>workout streak</span>
          </div>
        </div>
      )}

      <div className="calendar-header">
        <button className="link" onClick={prevMonth}>← previous</button>
        <strong>{monthName}</strong>
        <button className="link" onClick={nextMonth}>next →</button>
      </div>

      <div className="calendar-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="calendar-dow">{d}</div>
        ))}
        {cells.map((cell, i) =>
          cell === null ? (
            <div key={`pad-${i}`} className="calendar-cell empty" />
          ) : (
            <div
              key={cell.date}
              className={`calendar-cell ${cell.date === todayStr ? 'today' : ''} ${selected?.date === cell.date ? 'selected' : ''}`}
              onClick={() => cell.workout && setSelected(cell.workout)}
            >
              <span className="day-number">
                {cell.day}
                {cell.workout?.compliancePct != null && (
                  <span
                    className={`pct-badge ${
                      cell.workout.compliancePct >= 90 ? 'good' : cell.workout.compliancePct >= 60 ? 'ok' : 'low'
                    }`}
                    title="Percent of planned mileage and vert completed (Strava)"
                  >
                    {cell.workout.compliancePct}%
                  </span>
                )}
              </span>
              {cell.workout && (
                <>
                  <span className={`workout-chip ${cell.workout.workoutType} ${cell.workout.status}`}>
                    {TYPE_LABELS[cell.workout.workoutType] || cell.workout.workoutType}
                    {cell.workout.status !== 'planned' && ` · ${cell.workout.status}`}
                  </span>
                  {actuals[cell.date] ? (
                    <span className="cell-actual">
                      {fmtStats(actuals[cell.date].distanceMi, actuals[cell.date].elevationFt)}
                    </span>
                  ) : (
                    (cell.workout.targetDistanceMi != null || cell.workout.targetElevationFt != null) && (
                      <span className="cell-stats">
                        {fmtStats(cell.workout.targetDistanceMi, cell.workout.targetElevationFt)}
                      </span>
                    )
                  )}
                </>
              )}
              {!cell.workout && actuals[cell.date] && (
                <span className="cell-actual">
                  {fmtStats(actuals[cell.date].distanceMi, actuals[cell.date].elevationFt)}
                </span>
              )}
            </div>
          )
        )}
      </div>

      {selected && (
        <div className="workout-detail">
          <h4>{selected.date} — {TYPE_LABELS[selected.workoutType] || selected.workoutType}</h4>
          <p>{selected.description}</p>
          <p className="hint">
            {'Planned: '}
            {[
              selected.targetDistanceMi != null && `${selected.targetDistanceMi} mi`,
              selected.targetElevationFt != null && `${selected.targetElevationFt.toLocaleString()} ft vert`,
              selected.targetDurationMin != null && `${selected.targetDurationMin} min`,
            ].filter(Boolean).join(' · ') || 'no targets'}
            {' · status: '}{selected.status}
          </p>
          {selected.actualDistanceMi != null && (
            <p className="hint">
              {'Actual (Strava): '}
              {`${selected.actualDistanceMi} mi · ${selected.actualElevationFt.toLocaleString()} ft vert`}
              {selected.distancePct != null && ` · ${selected.distancePct}% of mileage`}
              {selected.vertPct != null && ` · ${selected.vertPct}% of vert`}
            </p>
          )}
          <div className="workout-actions">
            <button disabled={busy || selected.status === 'completed'}
              onClick={() => handleWorkoutUpdate(selected.id, { status: 'completed' })}>
              Mark completed
            </button>
            <button disabled={busy || selected.status === 'skipped'}
              onClick={() => handleWorkoutUpdate(selected.id, { status: 'skipped' })}>
              Skip
            </button>
            <button className="link" disabled={busy}
              onClick={() => {
                const description = window.prompt('Describe the change (this becomes a note your coach respects):', selected.description)
                if (description && description !== selected.description) {
                  handleWorkoutUpdate(selected.id, { description })
                }
              }}>
              Edit description
            </button>
            <button className="link" onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
    </section>
  )
}
