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
                background: 'rgba(20, 20, 23, 0.92)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                color: '#f3f4f6',
                border: '1px solid rgba(150, 131, 255, 0.2)',
                borderRadius: '14px',
                fontFamily: 'Onest, sans-serif',
                fontSize: '13px',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
              },
              classNames: {
                actionButton:
                  '!bg-primary !text-secondary !font-semibold !rounded-md !text-xs',
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
