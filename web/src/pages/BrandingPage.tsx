import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { brandingApi } from '../api/client'
import type { BrandingSettings } from '../types'

export default function BrandingPage() {
  const qc = useQueryClient()
  const { data: branding } = useQuery({ queryKey: ['branding'], queryFn: brandingApi.get })
  const [form, setForm] = useState<Partial<BrandingSettings>>({})

  useEffect(() => { if (branding) setForm(branding) }, [branding])

  const saveMutation = useMutation({
    mutationFn: () => brandingApi.update(form as BrandingSettings),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branding'] }),
  })

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-2xl font-semibold text-white">Branding & White-label</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
        {([
          ['companyName', 'Company Name'],
          ['appTitle', 'App Title (browser tab)'],
          ['logoUrl', 'Logo URL'],
          ['supportEmail', 'Support Email'],
          ['supportUrl', 'Support URL'],
        ] as [keyof BrandingSettings, string][]).map(([k, label]) => (
          <div key={k} className="space-y-1">
            <label className="text-sm text-gray-400">{label}</label>
            <input className="input w-full" value={(form as Record<string, string>)[k] ?? ''}
              onChange={e => setForm({ ...form, [k]: e.target.value })} />
          </div>
        ))}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm text-gray-400">Primary Color</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={form.primaryColor ?? '#2563EB'}
                onChange={e => setForm({ ...form, primaryColor: e.target.value })}
                className="w-10 h-9 rounded cursor-pointer border-0 bg-transparent" />
              <input className="input flex-1 font-mono text-sm" value={form.primaryColor ?? '#2563EB'}
                onChange={e => setForm({ ...form, primaryColor: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm text-gray-400">Accent Color</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={form.accentColor ?? '#7C3AED'}
                onChange={e => setForm({ ...form, accentColor: e.target.value })}
                className="w-10 h-9 rounded cursor-pointer border-0 bg-transparent" />
              <input className="input flex-1 font-mono text-sm" value={form.accentColor ?? '#7C3AED'}
                onChange={e => setForm({ ...form, accentColor: e.target.value })} />
            </div>
          </div>
        </div>

        <button
          onClick={() => saveMutation.mutate()}
          className="w-full py-2.5 bg-primary/80 hover:bg-primary text-white rounded-lg font-medium transition"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save Branding'}
        </button>

        {saveMutation.isSuccess && <p className="text-green-400 text-sm text-center">Saved! Refresh to apply colors.</p>}
      </div>
    </div>
  )
}
