import { useEffect, useState } from 'react'
import { api } from './api'
import ProfileForm from './ProfileForm'
import StravaSection from './StravaSection'
import PlanCalendar from './PlanCalendar'
import './App.css'

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const userId = localStorage.getItem('userId')
    if (!userId) {
      setLoading(false)
      return
    }
    api
      .getUser(userId)
      .then(setUser)
      .catch(() => localStorage.removeItem('userId'))
      .finally(() => setLoading(false))
  }, [])

  const handleRegister = async (profile) => {
    const created = await api.createUser(profile)
    localStorage.setItem('userId', created.id)
    setUser(created)
  }

  const handleUpdate = async (profile) => {
    const updated = await api.updateUser(user.id, profile)
    setUser(updated)
    setEditing(false)
  }

  const handleSignOut = () => {
    localStorage.removeItem('userId')
    setUser(null)
    setEditing(false)
  }

  if (loading) return <main><p>Loading…</p></main>

  if (!user) {
    return (
      <main>
        <h1>R2R2R Training</h1>
        <p className="tagline">
          Adaptive Rim-to-Rim-to-Rim training plans, texted to you every evening and
          tuned to your Strava training load.
        </p>
        <h2>Create your profile</h2>
        <ProfileForm submitLabel="Register" onSubmit={handleRegister} />
      </main>
    )
  }

  if (editing) {
    return (
      <main>
        <h1>Edit profile</h1>
        <ProfileForm initial={user} submitLabel="Save changes" onSubmit={handleUpdate} />
        <button className="link" onClick={() => setEditing(false)}>Cancel</button>
      </main>
    )
  }

  return (
    <main>
      <h1>R2R2R Training</h1>
      <section className="profile-card">
        <h2>{user.name}</h2>
        <dl>
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Phone</dt>
          <dd>{user.phone} {user.phoneVerified ? '✓ verified' : '(not yet verified)'}</dd>
          <dt>Goal date</dt><dd>{user.goalDate}</dd>
          <dt>Experience</dt><dd>{user.experienceLevel}</dd>
          <dt>Evening text</dt><dd>{user.sendTime} ({user.timezone})</dd>
          <dt>Training days</dt>
          <dd>
            {Object.entries(user.weeklyAvailability)
              .map(([day, hours]) => `${day} (${hours}h)`)
              .join(', ') || 'none set'}
          </dd>
        </dl>
        <button onClick={() => setEditing(true)}>Edit profile</button>
        <button className="link" onClick={handleSignOut}>Sign out</button>
      </section>
      <StravaSection userId={user.id} />
      <PlanCalendar userId={user.id} />
      <section className="coming-soon">
        <h3>Coming soon</h3>
        <ul>
          <li>Text back to adjust your plan (agentic SMS chat)</li>
          <li>Compliance tracking and encouragement</li>
        </ul>
      </section>
    </main>
  )
}
