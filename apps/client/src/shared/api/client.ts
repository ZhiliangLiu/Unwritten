import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@unwritten/contracts';

export type ApiClient = ContractRouterClient<Contract>;

export function createApiClient(token: string): ApiClient {
  const link = new RPCLink({
    url: `${location.origin}/api`,
    headers: { authorization: `Bearer ${token}` },
  });
  return createORPCClient(link) as ApiClient;
}
