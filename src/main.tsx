import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode removido em desenvolvimento para evitar dupla execução
// de useEffect (causa loop com supabase.auth.onAuthStateChange)
createRoot(document.getElementById('root')!).render(<App />)
