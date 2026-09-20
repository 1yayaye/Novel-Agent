export function rendererUrl(isPackaged: boolean, developmentUrl: string | undefined): string | undefined {
  return isPackaged ? undefined : developmentUrl
}
