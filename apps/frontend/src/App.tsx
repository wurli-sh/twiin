import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { config } from '@/config/wagmi'
import { MainLayout } from '@/components/layout/MainLayout'
import { HomePage } from '@/pages/HomePage'
import { AgentsPage } from '@/pages/AgentsPage'
import { ConsolePage } from '@/pages/ConsolePage'
import { MarketplacePage } from '@/pages/MarketplacePage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 2,
    },
  },
})

export function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: '#1A1A1A',
                color: '#FFFFFF',
                border: '1px solid #2C2C2C',
                borderRadius: '0',
                fontFamily: 'Onest, sans-serif',
                fontSize: '13px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18)',
              },
              classNames: {
                actionButton: '!bg-primary-bright !text-primary !font-semibold !text-xs',
              },
            }}
          />
          <Routes>
            <Route element={<MainLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/console" element={<ConsolePage />} />
              <Route path="/marketplace" element={<MarketplacePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
