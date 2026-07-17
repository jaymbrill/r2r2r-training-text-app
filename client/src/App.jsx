import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [serverStatus, setServerStatus] = useState('checking...')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setServerStatus(data.status))
      .catch(() => setServerStatus('offline'))
  }, [])

  return (
    <main>
      <h1>R2R2R Training Text App</h1>
      <p>Server status: {serverStatus}</p>
    </main>
  )
}

export default App
