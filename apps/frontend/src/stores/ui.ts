import { create } from 'zustand'

interface UIState {
  activeAgentsTab: string
  activeMarketplaceTab: string
  activeFeedsTab: string
  selectedAgentId: string | null
  setActiveAgentsTab: (tab: string) => void
  setActiveMarketplaceTab: (tab: string) => void
  setActiveFeedsTab: (tab: string) => void
  setSelectedAgentId: (id: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  activeAgentsTab: 'mine',
  activeMarketplaceTab: 'native',
  activeFeedsTab: 'published',
  selectedAgentId: null,
  setActiveAgentsTab: (tab) => set({ activeAgentsTab: tab }),
  setActiveMarketplaceTab: (tab) => set({ activeMarketplaceTab: tab }),
  setActiveFeedsTab: (tab) => set({ activeFeedsTab: tab }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
}))
