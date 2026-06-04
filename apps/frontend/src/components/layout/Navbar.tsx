import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, ClipboardCopy, ExternalLink, LogOut, Cpu } from 'lucide-react'
import { useWallet } from '@/hooks/useWallet'

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
    <header className="sticky top-0 z-40 flex justify-center px-4 w-full">
      <div className="mt-4 grid h-14 w-full max-w-5xl grid-cols-[1fr_auto_1fr] items-center rounded-2xl bg-surface/80 backdrop-blur-md px-4 sm:px-6 shadow-xl border border-border">
        {/* Brand — left */}
        <Link to="/" className="flex items-center gap-2 select-none group">
          <div className="size-7 rounded-lg bg-gradient-to-tr from-primary to-accent flex items-center justify-center shadow-md">
            <Cpu size={14} className="text-secondary animate-pulse" />
          </div>
          <span className="text-base font-bold tracking-tight text-text group-hover:text-primary transition-colors">
            Twiin
          </span>
        </Link>

        {/* Nav links — center */}
        <nav className="flex items-center justify-center gap-0.5 sm:gap-1">
          {navLinks.map(({ to, label }) => {
            const isActive = pathname === to || (to !== '/' && pathname.startsWith(to))
            return (
              <Link
                key={to}
                to={to}
                className={`relative rounded-xl px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium transition-colors duration-200 ${
                  isActive ? 'text-primary' : 'text-text-muted hover:text-text'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute inset-0 rounded-xl bg-primary/10 border border-primary/20"
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Wallet — right */}
        <div className="flex justify-end" ref={menuRef}>
          {isConnecting ? (
            <div className="flex items-center gap-2 rounded-xl bg-white/5 px-5 py-2 border border-border">
              <div className="h-4 w-20 animate-pulse rounded bg-white/10" />
            </div>
          ) : !isConnected ? (
            <div className="relative">
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => setWalletMenuOpen(!walletMenuOpen)}
                className="flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 sm:px-5 py-2 text-xs sm:text-sm font-bold text-secondary shadow-md hover:shadow-primary/25 transition-all"
              >
                Connect Wallet
              </motion.button>

              <AnimatePresence>
                {walletMenuOpen && (
                  <motion.div
                    className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-surface border border-border-strong shadow-2xl overflow-hidden z-50"
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="px-4 py-3 border-b border-border">
                      <span className="text-[10px] font-bold text-text-faint uppercase tracking-wider">
                        Choose Wallet
                      </span>
                    </div>
                    <div className="p-1">
                      {connectors.map((connector) => (
                        <button
                          key={connector.uid}
                          onClick={() => connectWith(connector)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-semibold text-text hover:bg-surface-alt rounded-lg transition-colors cursor-pointer"
                        >
                          {connector.icon ? (
                            <img src={connector.icon} alt="" className="size-4 rounded" />
                          ) : (
                            <div className="size-4 rounded bg-primary" />
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
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface-alt hover:bg-surface-hover transition-colors px-4 sm:px-5 py-2 border border-border"
              >
                <span className="text-xs sm:text-sm font-semibold text-text font-mono">{display}</span>
                <ChevronDown
                  size={12}
                  className={`text-text-faint transition-transform duration-200 ${walletMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {walletMenuOpen && (
                  <motion.div
                    className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-surface border border-border shadow-2xl overflow-hidden z-50"
                    initial={{ opacity: 0, y: -8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="px-4 py-3 border-b border-border/80">
                      <p className="text-[10px] font-bold text-text-faint uppercase tracking-wider">Connected Wallet</p>
                      <p className="text-[11px] text-text-muted mt-0.5 font-mono truncate">
                        {address}
                      </p>
                    </div>
                    <div className="p-1 space-y-0.5">
                      <button
                        onClick={() => {
                          if (address) {
                            navigator.clipboard.writeText(address)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 1500)
                          }
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold text-text hover:bg-surface-alt rounded-lg transition-colors cursor-pointer"
                      >
                        <ClipboardCopy size={13} className="text-text-faint" />
                        {copied ? 'Copied!' : 'Copy Address'}
                      </button>
                      <a
                        href={`https://shannon-explorer.somnia.network/address/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold text-text hover:bg-surface-alt rounded-lg transition-colors cursor-pointer"
                      >
                        <ExternalLink size={13} className="text-text-faint" />
                        Explorer
                      </a>
                      <button
                        onClick={() => { disconnect(); setWalletMenuOpen(false) }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/10 rounded-lg transition-colors cursor-pointer border-t border-border/50"
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
