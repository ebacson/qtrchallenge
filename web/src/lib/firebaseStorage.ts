import { getStorage } from 'firebase/storage'
import { app, STORAGE_BUCKET } from './firebase'

/**
 * Tách khỏi firebase.ts để SDK Storage chỉ tải cùng các trang cần upload/xóa file.
 * Explicit gs:// avoids wrong legacy appspot.com endpoint.
 */
export const storage = getStorage(app, `gs://${STORAGE_BUCKET.replace(/^gs:\/\//, '')}`)
