import { Route, Routes } from 'react-router-dom'
import EditPage from './pages/EditPage'
import LandingPage from './pages/LandingPage'
import PublicPage from './pages/PublicPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/edit" element={<EditPage />} />
      <Route path="/:slug" element={<PublicPage />} />
    </Routes>
  )
}
