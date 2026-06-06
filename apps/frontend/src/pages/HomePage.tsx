import { Hero } from '@/components/home/Hero'
import { GatewayBento } from '@/components/home/GatewayBento'
import { HowItWorks } from '@/components/home/HowItWorks'
import { Ecosystem } from '@/components/home/Ecosystem'
import { DeploymentCTA } from '@/components/home/DeploymentCTA'
import { CinematicFooter } from '@/components/home/CinematicFooter'

export function HomePage() {
  return (
    <div className="bg-linear-to-b from-primary-bright/8 via-background to-background">
      <Hero />
      <GatewayBento />
      <HowItWorks />
      <Ecosystem />
      <DeploymentCTA />
      <CinematicFooter />
    </div>
  )
}
