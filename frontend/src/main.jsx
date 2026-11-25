import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { AuthProvider } from './context/AuthContext'
import { SiteProvider } from './context/SiteContext'
import { BrandingProvider } from './context/BrandingContext'
import { InventoryProvider } from './context/InventoryContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <BrandingProvider>
          <AuthProvider>
            <SiteProvider>
              <InventoryProvider>
                <App />
              </InventoryProvider>
            </SiteProvider>
          </AuthProvider>
        </BrandingProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
)
