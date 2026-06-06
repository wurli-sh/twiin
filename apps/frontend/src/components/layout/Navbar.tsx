import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, ClipboardCopy, ExternalLink, LogOut } from 'lucide-react'
import { useWallet } from '@/hooks/useWallet'
import { cn } from '@/lib/cn'

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/agents', label: 'Agents' },
  { to: '/console', label: 'Console' },
  { to: '/marketplace', label: 'Marketplace' },
] as const

export function Navbar() {
  const { pathname } = useLocation()
  const { address, isConnected, isConnecting, connectors, connectWith, disconnect } = useWallet()
  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const display = address ? `${address.slice(0, 5)}...${address.slice(-4)}` : ''

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setWalletMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    setWalletMenuOpen(false)
  }, [isConnected, pathname])

  return (
    <header className="sticky top-0 z-40 flex w-full justify-center px-4">
      <div className="mt-4 grid h-14 w-full max-w-5xl grid-cols-[1fr_auto_1fr] items-center bg-charcoal/95 px-4 shadow-elev backdrop-blur-md sm:px-6">
        <Link to="/" className="group flex select-none items-center gap-2">
          <div className="flex size-4ta items-center justify-center bg-primary-bright shadow-lime-pill">
          </div>
          <span className="text-base font-bold tracking-tight text-primary-bright group-hover:text-white transition-colors">
            Twiin
          </span>
        </Link>

        <nav className="flex items-center justify-center gap-0.5 sm:gap-1">
          {navLinks.map(({ to, label }) => {
            const isActive = pathname === to || (to !== '/' && pathname.startsWith(to))
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'relative px-3 py-1.5 text-xs font-medium transition-colors duration-200 sm:px-4 sm:text-sm',
                  isActive ? 'text-white' : 'text-white/60 hover:text-white',
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute inset-0 bg-white/15"
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="flex justify-end" ref={menuRef}>
          {isConnecting ? (
            <div className="flex items-center gap-2 border border-white/10 bg-charcoal-soft px-5 py-2">
              <div className="h-4 w-20 animate-pulse bg-white/10" />
            </div>
          ) : !isConnected ? (
            <div className="relative">
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => setWalletMenuOpen(!walletMenuOpen)}
                className="pill-gradient flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap bg-primary-bright px-4 py-2 text-xs font-semibold text-primary shadow-lime-pill sm:px-5 sm:text-sm"
              >
                Connect Wallet
              </motion.button>

              <AnimatePresence>
                {walletMenuOpen && (
                  <motion.div
                    className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden border border-border bg-background shadow-elev"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="border-b border-border px-4 py-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Choose Wallet
                      </span>
                    </div>
                    <div className="p-1">
                      {connectors.map((connector) => (
                        <button
                          key={connector.uid}
                          onClick={() => connectWith(connector)}
                          className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                        >
                          {connector.icon ? (
                            <img src={connector.icon} alt="" className="size-4" />
                          ) : (
                            <div className="size-4 bg-primary-bright" />
                          )}
                          {connector.name}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setWalletMenuOpen(!walletMenuOpen)}
                className="flex cursor-pointer items-center justify-center gap-2 border border-white/10 bg-charcoal-soft px-4 py-2 transition-colors hover:bg-charcoal sm:px-5"
              >
                <span className="font-mono text-xs font-semibold text-white sm:text-sm">{display}</span>
                <ChevronDown
                  size={12}
                  className={cn('text-white/50 transition-transform duration-200', walletMenuOpen && 'rotate-180')}
                />
              </button>

              <AnimatePresence>
                {walletMenuOpen && (
                  <motion.div
                    className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden border border-border bg-background shadow-elev"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="border-b border-border px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Connected Wallet
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{address}</p>
                    </div>
                    <div className="space-y-0.5 p-1">
                      <button
                        onClick={() => {
                          if (address) {
                            navigator.clipboard.writeText(address)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 1500)
                          }
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                      >
                        <ClipboardCopy size={13} className="text-muted-foreground" />
                        {copied ? 'Copied!' : 'Copy Address'}
                      </button>
                      <a
                        href={`https://shannon-explorer.somnia.network/address/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                      >
                        <ExternalLink size={13} className="text-muted-foreground" />
                        Explorer
                      </a>
                      <button
                        onClick={() => {
                          disconnect()
                          setWalletMenuOpen(false)
                        }}
                        className="flex w-full cursor-pointer items-center gap-3 border-t border-border px-3 py-2 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
                      >
                        <LogOut size={13} />
                        Disconnect
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
