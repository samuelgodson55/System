import { pool } from './pool.js'
import { applySchema } from './schema.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await applySchema(client)
    console.log('Migration completed successfully')
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch((e) => {
  console.error(e)
  process.exit(1)
})
