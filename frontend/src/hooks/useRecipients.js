import { useCallback, useEffect, useState } from 'react'
import { api } from '../utils/api'

/** The saved recipient list (A–Z) for pick-lists. `reload` re-reads it after an issue or an edit. */
export function useRecipients() {
  const [recipients, setRecipients] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      setRecipients(await api.getRecipients())
    } catch (e) {
      // the pick-list is a convenience: typing a name still works if it cannot be loaded
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { recipients, loading, reload }
}
