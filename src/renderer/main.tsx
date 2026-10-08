import ReactDOM from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import App from './App'
import './styles.css'

// Theme before first paint. Electron's theme already reflects the saved choice, so the
// media query is right immediately; the saved mode then keeps System/Light/Dark exact.
const dark = matchMedia('(prefers-color-scheme: dark)')
let mode: 'system' | 'light' | 'dark' = 'system'
const apply = () => { document.documentElement.dataset.theme = mode === 'system' ? dark.matches ? 'dark' : 'light' : mode }
apply()
dark.addEventListener('change', apply)
window.addEventListener('chatos-theme', event => { mode = (event as CustomEvent<typeof mode>).detail; apply() })
void window.chatos.theme().then(saved => { mode = saved; apply() }).catch(() => {})

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
