import { Navigate, useParams } from 'react-router-dom'

/** Короткая реферальная ссылка вида /r/:slug → публичная страница. */
export default function ReferralRedirect() {
  const { slug } = useParams()
  if (!slug) return null
  return <Navigate to={`/${encodeURIComponent(slug)}`} replace />
}
