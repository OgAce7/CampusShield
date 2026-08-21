import { useEffect, useState } from 'react'
import { BOYS_HOSTELS, GIRLS_HOSTELS, MESS_LOCATIONS } from './campusData'

const API_BASE_URL = 'http://localhost:8000'

function BlockGrid({ title, blocks }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>{title}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {blocks.map((block) => (
          <div
            key={block}
            style={{
              border: '1px solid #ccc',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              minWidth: '70px',
              textAlign: 'center',
              fontFamily: 'monospace',
              background: '#fafafa',
            }}
          >
            {block}
          </div>
        ))}
      </div>
    </div>
  )
}

function App() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE_URL}/health`)
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch((err) => setError(err.message))
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
      <h1>Hostel Outbreak Radar</h1>
      <p style={{ color: '#666' }}>
        Project skeleton. Campus blocks shown below are placeholders for a future
        schematic layout — not a real map.
      </p>

      <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', border: '1px solid #ddd', borderRadius: '6px' }}>
        <strong>Backend status: </strong>
        {health && <span style={{ color: 'green' }}>{health.status} ({health.service})</span>}
        {error && <span style={{ color: 'red' }}>unreachable ({error})</span>}
        {!health && !error && <span>checking...</span>}
      </div>

      <BlockGrid title="Boys Hostels" blocks={BOYS_HOSTELS} />
      <BlockGrid title="Girls Hostels" blocks={GIRLS_HOSTELS} />
      <BlockGrid title="Mess" blocks={MESS_LOCATIONS} />
    </div>
  )
}

export default App
