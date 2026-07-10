export function useRouter() {
  return {
    push: (url: string) => {
      window.location.href = url
    },
    replace: (url: string) => {
      window.location.replace(url)
    },
    refresh: () => {
      window.location.reload()
    },
    back: () => {
      window.history.back()
    },
  }
}

export function usePathname() {
  return window.location.pathname
}

export function useSearchParams() {
  return new URLSearchParams(window.location.search)
}
