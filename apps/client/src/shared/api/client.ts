import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@unwritten/contracts';

export type ApiClient = ContractRouterClient<Contract>;

export function createApiClient(token: string, onSessionExpired?: () => void): ApiClient {
  const link = new RPCLink({
    url: `${location.origin}/api`,
    headers: { authorization: `Bearer ${token}` },
    async fetch(request, init) {
      let response: Response;
      try {
        response = await globalThis.fetch(request, init);
      } catch (error) {
        if (request.signal.aborted) throw error;
        throw new ORPCError('core_unreachable', { cause: error });
      }
      if (response.status === 401) {
        onSessionExpired?.();
        throw new ORPCError('UNAUTHORIZED');
      }
      return response;
    },
  });
  return createORPCClient(link) as ApiClient;
}
