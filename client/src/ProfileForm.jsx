import { useState } from 'react'

const DAYS = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
]

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
]

const emptyProfile = {
  name: '',
  email: '',
  phone: '',
  timezone: 'America/Denver',
  goalDate: '',
  experienceLevel: 'intermediate',
  weeklyAvailability: { sat: 4, sun: 4 },
  sendTime: '20:00',
}

export default function ProfileForm({ initial, submitLabel, onSubmit }) {
  const [form, setForm] = useState(initial || emptyProfile)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const setAvailability = (day, hours) => {
    setForm((f) => {
      const next = { ...f.weeklyAvailability }
      if (hours === '' || Number(hours) === 0) delete next[day]
      else next[day] = Number(hours)
      return { ...f, weeklyAvailability: next }
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="profile-form">
      {error && <p className="error">{error}</p>}

      <label>
        Name
        <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </label>

      <label>
        Email
        <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
      </label>

      <label>
        Mobile phone (for training texts)
        <input
          type="tel"
          placeholder="+1 555 123 4567"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          required
        />
      </label>

      <label>
        Time zone
        <select value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </label>

      <label>
        R2R2R goal date
        <input type="date" value={form.goalDate} onChange={(e) => set('goalDate', e.target.value)} required />
      </label>

      <label>
        Experience level
        <select value={form.experienceLevel} onChange={(e) => set('experienceLevel', e.target.value)}>
          <option value="beginner">Beginner — new to ultra-distance efforts</option>
          <option value="intermediate">Intermediate — long trail runs/hikes regularly</option>
          <option value="advanced">Advanced — experienced ultra runner</option>
        </select>
      </label>

      <fieldset>
        <legend>Weekly availability (hours per day you can train)</legend>
        {DAYS.map(([key, label]) => (
          <label key={key} className="availability-row">
            <span>{label}</span>
            <input
              type="number"
              min="0"
              max="12"
              step="0.5"
              value={form.weeklyAvailability[key] ?? ''}
              onChange={(e) => setAvailability(key, e.target.value)}
              placeholder="0"
            />
          </label>
        ))}
      </fieldset>

      <label>
        Evening text time (when to receive tomorrow's plan)
        <input type="time" value={form.sendTime} onChange={(e) => set('sendTime', e.target.value)} />
      </label>

      <button type="submit" disabled={saving}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
