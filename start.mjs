/**
 * Запуск uvicorn через Node: на части хостингов `npm start` превращается в
 * `node <одна_строка_из_scripts>` — shell-скрипты ломаются. Этот файл — реальная точка входа.
 */
import { spawnSync } from 'node:child_process'

const port = process.env.PORT || '3000'
const uvicornArgs = [
  '-m',
  'uvicorn',
  'main:app',
  '--host',
  '0.0.0.0',
  '--port',
  String(port),
]

/** @type {readonly [string, string[]][]} */
const attempts = [
  ['python3', uvicornArgs],
  ['python', uvicornArgs],
  ['py', ['-3', ...uvicornArgs]],
]

for (const [cmd, cmdArgs] of attempts) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit' })
  if (r.error) {
    if (r.error.code === 'ENOENT') continue
    console.error(r.error)
    process.exit(1)
  }
  process.exit(r.status === null ? 1 : r.status)
}

console.error(
  'Не найден python3/python/py в PATH. Установи Python 3 и выполни: pip install -r requirements.txt',
)
process.exit(1)
