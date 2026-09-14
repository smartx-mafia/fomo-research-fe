'use client';

import dynamic from 'next/dynamic';

// Privy useLinkAccount reads browser-only provider refs during render. Keep the
// onboarding route as a static shell and mount the authenticated flow in-browser.
const OnboardingView = dynamic(
  () => import('@/components/OnboardingView').then((module) => module.OnboardingView),
  {ssr: false, loading: () => <p className="text-sm text-muted">Loading onboarding…</p>},
);

export default function OnboardingPage() {
  return <OnboardingView />;
}
