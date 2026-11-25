import type { EndpointView } from '@unwritten/contracts';

export interface EndpointEditState {
  id: string;
  name: string;
  modelId: string;
  keyAction: 'keep' | 'set' | 'remove';
  keyValue: string;
}

export function beginEndpointEdit(endpoint: EndpointView): EndpointEditState {
  return {
    id: endpoint.id,
    name: endpoint.name,
    modelId: endpoint.models[0]?.id ?? '',
    keyAction: 'keep',
    keyValue: '',
  };
}
