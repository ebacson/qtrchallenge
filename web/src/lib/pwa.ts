function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function waitUntilInstalled(sw: ServiceWorker, ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    sw.addEventListener('statechange', () => {
      if (sw.state !== 'installing') {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

/** Tải lại web; nếu service worker vừa tìm thấy bản mới thì kích hoạt bản đó trước. */
export async function reloadApp(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined)
    if (reg) {
      await reg.update().catch(() => {})
      if (reg.installing) await waitUntilInstalled(reg.installing, 8000)
      if (reg.waiting && navigator.serviceWorker.controller) {
        const switched = new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          })
        })
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        await Promise.race([switched, delay(3000)])
      }
    }
  }
  window.location.reload()
}
