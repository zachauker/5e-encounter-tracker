import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CampaignState {
  activeCampaignId: string | null;
  setActiveCampaignId: (id: string) => void;
  // Bumped whenever a campaign is created or renamed, so consumers that cache
  // the campaign list (the persistent TopBar, the dashboard) re-fetch and stay
  // in sync without a full reload.
  campaignsVersion: number;
  bumpCampaigns: () => void;
}

export const useCampaignStore = create<CampaignState>()(
  persist(
    (set) => ({
      activeCampaignId: null,
      setActiveCampaignId: (id) => set({ activeCampaignId: id }),
      campaignsVersion: 0,
      bumpCampaigns: () => set((s) => ({ campaignsVersion: s.campaignsVersion + 1 })),
    }),
    {
      name: "campaign-store",
      skipHydration: true,
      partialize: (s) => ({ activeCampaignId: s.activeCampaignId }),
    }
  )
);
