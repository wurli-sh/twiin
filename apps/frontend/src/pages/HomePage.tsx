import { HeroSection } from '@/components/home/HeroSection'
import { HowItWorks } from '@/components/home/HowItWorks'
import { ConsoleSection } from '@/components/home/ConsoleSection'
import { CallToAction } from '@/components/home/CallToAction'
import { Footer } from '@/components/layout/Footer'

export function HomePage() {
  return (
    <>
      <HeroSection />
      <HowItWorks />
      <ConsoleSection />
      <CallToAction />
      <Footer />
    </>
  )
}
