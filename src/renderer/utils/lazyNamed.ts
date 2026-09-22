import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

type NamedComponent<M, K extends keyof M> = Extract<M[K], ComponentType<any>>

export function lazyNamed<M, K extends keyof M>(
  loader: () => Promise<M>,
  exportName: K
): LazyExoticComponent<NamedComponent<M, K>> {
  return lazy(() =>
    loader().then((mod) => ({ default: mod[exportName] as NamedComponent<M, K> }))
  )
}
