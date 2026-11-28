import { useQuery } from '@tanstack/react-query';
import type { ErrorCode, ImageServiceState, LauncherFailureReason } from '@unwritten/contracts';
import { useApi } from '../api/context.tsx';
import { queryKeys } from '../api/query.ts';

type ImageServiceStateView = {
  state: ImageServiceState;
  action: { url: string; expiresAt: number } | null;
  wakeFailure: { code: ErrorCode; reason: LauncherFailureReason | null } | null;
};

const UNKNOWN: ImageServiceStateView = { state: 'unknown', action: null, wakeFailure: null };

export function useImageServiceState(serviceId: string | null): ImageServiceStateView {
  const api = useApi();
  const config = useQuery({ queryKey: queryKeys.imageConfig, queryFn: () => api.image.services.list() });
  const service =
    serviceId === null ? undefined : config.data?.services.find((candidate) => candidate.id === serviceId);
  if (!service) return UNKNOWN;
  return { state: service.state, action: service.action, wakeFailure: service.wakeFailure };
}
