/**
 * После `npm install` ставит пакеты из requirements.txt (uvicorn, fastapi, …).
 * На хостингах часто делают только npm ci — без этого `node start.mjs` падает.
 * Только Node: SKIP_PY_DEPS=1 npm ci
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.SKIP_PY_DEPS === '1') {
  console.info('[install-py-deps] SKIP_PY_DEPS=1 — пропуск.')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const req = path.join(root, 'requirements.txt')

const pipArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', req]

/** @type {readonly [string, string[]][]} */
const attempts = [
  ['python3', pipArgs],
  ['python', pipArgs],
  ['py', ['-3', ...pipArgs]],
]

for (const [cmd, args] of attempts) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root })
  if (r.error) {
    if (r.error.code === 'ENOENT') continue
    console.error(r.error)
    process.exit(1)
  }
  if (r.status !== 0) {
    console.error(
      '\n[install-py-deps] pip завершился с ошибкой. Вручную на сервере:\n' +
        '  python3 -m pip install -r requirements.txt\n' +
        'Или локально без Python: SKIP_PY_DEPS=1 npm ci\n',
    )
    process.exit(r.status ?? 1)
  }
  process.exit(0)
}

console.error(
  '\n[install-py-deps] Не найден python3/python/py. Установи Python 3 или задай SKIP_PY_DEPS=1.\n',
)
process.exit(1)
