import { Outlet, useLocation } from 'react-router-dom'
import { Navbar } from './Navbar'
import { NetworkBanner } from './NetworkBanner'

export function MainLayout() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const isConsole = pathname === '/console'

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <Navbar />
      <NetworkBanner />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {isHome ? (
          <Outlet />
        ) : isConsole ? (
          <div className="mx-auto h-full w-full max-w-5xl px-4 sm:px-6">
            <Outlet />
          </div>
        ) : (
          <div className="mx-auto h-full w-full max-w-5xl px-4 py-8 pt-6 sm:px-6">
            <Outlet />
          </div>
        )}
      </main>
    </div>
  )
}
