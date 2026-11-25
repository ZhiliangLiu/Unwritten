import { createContext, useContext } from 'react';
import type { ApiClient } from './client.ts';

const ApiContext = createContext<ApiClient | null>(null);

export const ApiProvider = ApiContext.Provider;

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiProvider is missing');
  return api;
}
