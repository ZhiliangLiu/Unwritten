export function isMacPlatform(): boolean {
  const navigatorWithData = navigator as Navigator & { userAgentData?: { platform?: string } };
  return (navigatorWithData.userAgentData?.platform ?? navigator.platform).includes('Mac');
}
