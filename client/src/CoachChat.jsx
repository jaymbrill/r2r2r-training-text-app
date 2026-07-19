import { useEffect, useRef, useState } from 'react'
import { api } from './api'

export default function CoachChat({ userId, onPlanChanged }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)
  const threadRef = useRef(null)

  useEffect(() => {
    api.chatHistory(userId).then(setMessages).catch(() => {})
  }, [userId])

  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  const send = async (e) => {
    e.preventDefault()
    const message = draft.trim()
    if (!message || sending) return
    setError(null)
    setNotice(null)
    setSending(true)
    setDraft('')
    setMessages((ms) => [...ms, { id: `tmp-${Date.now()}`, direction: 'inbound', body: message }])
    try {
      const result = await api.chatSend(userId, message)
      setMessages((ms) => [...ms, { id: `r-${Date.now()}`, direction: 'outbound', body: result.reply }])
      if (result.planChanged) {
        onPlanChanged?.()
        setNotice('Your calendar has been updated.')
      }
      if (result.planRegenerating) {
        setNotice('Rebuilding your plan — the calendar will refresh in a moment.')
        // Regeneration runs in the background; refresh the calendar as it lands
        setTimeout(() => onPlanChanged?.(), 15000)
        setTimeout(() => onPlanChanged?.(), 35000)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="chat-section">
      <h3>Talk to your coach</h3>
      <p className="hint">
        Ask about your plan or request changes — “what's my long run this weekend?”,
        “move Saturday's run to Sunday”, “my knee is sore”. Same conversation as your texts.
      </p>

      <div className="chat-thread" ref={threadRef}>
        {messages.length === 0 && !sending && (
          <p className="chat-empty">No messages yet — say hello to your coach.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.direction === 'inbound' ? 'mine' : 'coach'}`}>
            {m.body}
          </div>
        ))}
        {sending && <div className="chat-bubble coach typing">…</div>}
      </div>

      {notice && <p className="chat-notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <form className="chat-input" onSubmit={send}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message your coach…"
          maxLength={1000}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !draft.trim()}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </section>
  )
}
