import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invoked && path.resolve(__filename) === invoked) {
  console.error(
    '\n[taplink-style] Этот файл не является сервером. Запуск сайта и бота:\n' +
      '  npm start\n' +
      'или:  uvicorn main:app --host 0.0.0.0 --port 3000\n',
  )
  process.exit(1)
}

// Корневой минимальный flat-config без зависимостей (линт проекта: npm run lint).
export default [{}]
