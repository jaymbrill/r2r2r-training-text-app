import { useEffect, useState } from 'react'
import { api } from './api'
import ProfileForm from './ProfileForm'
import StravaSection from './StravaSection'
import PlanCalendar from './PlanCalendar'
import CanyonHero from './CanyonHero'
import { TermsPage, PrivacyPage } from './LegalPages'
import './App.css'

function Footer() {
  return (
    <footer className="site-footer">
      <a href="#/terms">Terms &amp; Conditions</a>
      <span aria-hidden="true">·</span>
      <a href="#/privacy">Privacy Statement</a>
      <span aria-hidden="true">·</span>
      <span>Msg &amp; data rates may apply. Reply STOP to opt out.</span>
    </footer>
  )
}

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export default function App() {
  const hash = useHashRoute()
  if (hash === '#/terms') {
    return (
      <>
        <CanyonHero compact title="Terms &amp; Conditions" />
        <main><TermsPage /><Footer /></main>
      </>
    )
  }
  if (hash === '#/privacy') {
    return (
      <>
        <CanyonHero compact title="Privacy Statement" />
        <main><PrivacyPage /><Footer /></main>
      </>
    )
  }
  return <Home />
}

function Home() {
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

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Delete your account? This permanently removes your profile, training plan, ' +
        'activity history, messages, and Strava connection. This cannot be undone.'
    )
    if (!confirmed) return
    try {
      await api.deleteUser(user.id)
      localStorage.removeItem('userId')
      setUser(null)
      setEditing(false)
    } catch (err) {
      window.alert(`Deleting the account failed: ${err.message}`)
    }
  }

  if (loading) return <main><p>Loading…</p></main>

  if (!user) {
    return (
      <>
        <CanyonHero
          title="R2R2R Training"
          subtitle="Adaptive Rim-to-Rim-to-Rim training plans, texted to you every evening and tuned to your Strava training load."
        />
        <main>
          <h2>Create your profile</h2>
          <ProfileForm submitLabel="Register" onSubmit={handleRegister} />
          <p className="consent-note">
            By registering you agree to the <a href="#/terms">Terms &amp; Conditions</a> and{' '}
            <a href="#/privacy">Privacy Statement</a>, and consent to receive recurring automated
            training texts at the number provided. Msg &amp; data rates may apply. Reply STOP to
            opt out, HELP for help.
          </p>
          <Footer />
        </main>
      </>
    )
  }

  if (editing) {
    return (
      <>
        <CanyonHero compact title="Edit profile" />
        <main>
          <ProfileForm initial={user} submitLabel="Save changes" onSubmit={handleUpdate} />
          <button className="link" onClick={() => setEditing(false)}>Cancel</button>
          <Footer />
        </main>
      </>
    )
  }

  return (
    <>
      <CanyonHero compact title="R2R2R Training" subtitle={`The Canyon is waiting, ${user.name.split(' ')[0]}.`} />
      <main>
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
          <button className="link danger" onClick={handleDeleteAccount}>Delete my account</button>
        </section>
        <StravaSection userId={user.id} />
        <PlanCalendar userId={user.id} />
        <Footer />
      </main>
    </>
  )
}
