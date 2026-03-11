import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { brandingApi } from '../api/client'

function hexToRgbParts(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}

export function useBranding() {
  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: brandingApi.get,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!branding) return

    const root = document.documentElement
    root.style.setProperty('--color-primary', hexToRgbParts(branding.primaryColor))
    root.style.setProperty('--color-accent', hexToRgbParts(branding.accentColor))

    if (branding.appTitle) document.title = branding.appTitle
  }, [branding])

  return branding
}
