import type { EndpointView } from '@unwritten/contracts';

export interface EndpointEditState {
  id: string;
  name: string;
  keyAction: 'keep' | 'set' | 'remove';
  keyValue: string;
}

export function beginEndpointEdit(endpoint: EndpointView): EndpointEditState {
  return {
    id: endpoint.id,
    name: endpoint.name,
    keyAction: 'keep',
    keyValue: '',
  };
}
