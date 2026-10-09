import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/app.css'
import './styles/team-analysis.css'
import './styles/minimal-theme.css'
import './styles/mossnyx-theme.css'
import { createBrowserApi } from './platform/browserApi'

if (!window.footballApi) window.footballApi = createBrowserApi()

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
