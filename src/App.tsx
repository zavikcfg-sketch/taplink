import { Route, Routes } from 'react-router-dom'
import CatalogPage from './pages/CatalogPage'
import EditPage from './pages/EditPage'
import LandingPage from './pages/LandingPage'
import PublicPage from './pages/PublicPage'
import ReferralRedirect from './pages/ReferralRedirect'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/edit" element={<EditPage />} />
      <Route path="/catalog" element={<CatalogPage />} />
      <Route path="/r/:slug" element={<ReferralRedirect />} />
      <Route path="/:slug" element={<PublicPage />} />
    </Routes>
  )
}
